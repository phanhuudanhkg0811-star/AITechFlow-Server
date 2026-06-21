/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { PDFParse } from 'pdf-parse';
import path from 'node:path';
import { spawn } from 'node:child_process';
import envConfig from 'src/shared/config';
import { CryptoService } from 'src/shared/services/crypto.service';
import { EmailService } from 'src/shared/services/mail.service';
import { PrismaService } from 'src/shared/services/prisma.service';
import { CvScreeningService } from './ai-cv-screening.service';
import { AiService } from './ai.service';

interface TechReviewPythonResult {
  verdict: 'PASS' | 'FAIL' | 'BORDERLINE';
  overall_score: number;
  seniority_estimate: 'Junior' | 'Mid-level' | 'Senior' | 'Staff';
  job_fit: {
    is_fit: boolean;
    reason: string;
  };
  architecture: {
    pattern: string;
    summary: string;
    scalability: string;
  };
  solid_scores: Record<string, { score: number; comment: string }>;
  issues: Array<{
    severity: 'HIGH' | 'MEDIUM' | 'LOW';
    file: string;
    line_hint: string;
    description: string;
    suggestion: string;
  }>;
  strengths: string[];
  red_flags: string[];
  interview_questions: string[];
}

export interface SyncSummary {
  success: boolean;
  accountId: string;
  email: string;
  scannedEmails: number;
  processedEmails: number;
  newCandidates: number;
  skippedEmails: number;
  errors: string[];
}

type JobForPipeline = NonNullable<
  Awaited<ReturnType<AiPipelineService['findMatchingJob']>>
>;

const CV_EMAIL_SCAN_DELAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AiPipelineService {
  private readonly logger = new Logger(AiPipelineService.name);

  constructor(
    private prisma: PrismaService,
    private cvScreeningService: CvScreeningService,
    private emailService: EmailService,
    private cryptoService: CryptoService,
    private aiService: AiService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleIncomingApplications() {
    const activeAccounts = await this.prisma.emailAccount.findMany({
      where: {
        isActive: true,
      },
      select: {
        id: true,
        email: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (activeAccounts.length === 0) {
      this.logger.debug('No active EmailAccount records to scan.');
      return {
        success: true,
        accounts: 0,
        processedEmails: 0,
        newCandidates: 0,
      };
    }

    this.logger.log(
      `Scanning ${activeAccounts.length} active IMAP account(s).`,
    );

    const summaries: SyncSummary[] = [];
    for (const account of activeAccounts) {
      summaries.push(await this.processSingleAccount(account.id));
    }

    return {
      success: summaries.every((summary) => summary.success),
      accounts: summaries.length,
      processedEmails: summaries.reduce(
        (total, summary) => total + summary.processedEmails,
        0,
      ),
      newCandidates: summaries.reduce(
        (total, summary) => total + summary.newCandidates,
        0,
      ),
      skippedEmails: summaries.reduce(
        (total, summary) => total + summary.skippedEmails,
        0,
      ),
      summaries,
    };
  }

  async processSingleAccount(accountId: string): Promise<SyncSummary> {
    const account = await this.prisma.emailAccount.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        email: true,
        encryptedPassword: true,
        isActive: true,
        companyId: true,
      },
    });

    if (!account) throw new NotFoundException('Email account not found');

    const summary: SyncSummary = {
      success: true,
      accountId: account.id,
      email: account.email,
      scannedEmails: 0,
      processedEmails: 0,
      newCandidates: 0,
      skippedEmails: 0,
      errors: [],
    };

    if (!account.isActive) {
      return {
        ...summary,
        success: false,
        errors: ['Email account is inactive'],
      };
    }

    if (!account.encryptedPassword) {
      return {
        ...summary,
        success: false,
        errors: ['Email account has no encrypted password'],
      };
    }

    let client: ImapFlow | null = null;
    try {
      client = this.createImapClient(
        account.email,
        this.cryptoService.decrypt(account.encryptedPassword),
      );
      await client.connect();

      const accountSummary = await this.scanMailbox(client, account.id);
      Object.assign(summary, accountSummary);

      await this.prisma.emailAccount.update({
        where: { id: account.id },
        data: { lastUsed: new Date() },
      });
    } catch (error) {
      summary.success = false;
      summary.errors.push(
        error instanceof Error ? error.message : 'Unknown IMAP sync error',
      );
      this.logger.error(`IMAP sync failed for ${account.email}:`, error);
    } finally {
      if (client) {
        await client.logout().catch(() => undefined);
      }
    }

    return summary;
  }

  private createImapClient(email: string, password: string) {
    const client = new ImapFlow({
      host: envConfig.IMAP_HOST,
      port: envConfig.IMAP_PORT,
      secure: true,
      auth: {
        user: email,
        pass: password,
      },
      logger: false,
      socketTimeout: 0,
      connectionTimeout: 30000,
    });

    client.on('error', (error) => {
      this.logger.error(`IMAP background error [${email}]: ${error.message}`);
    });

    return client;
  }

  private async scanMailbox(client: ImapFlow, emailAccountId: string) {
    const summary = {
      scannedEmails: 0,
      processedEmails: 0,
      newCandidates: 0,
      skippedEmails: 0,
      errors: [] as string[],
    };

    let lock;
    try {
      lock = await client.getMailboxLock('INBOX');
      const olderThan = new Date(Date.now() - CV_EMAIL_SCAN_DELAY_MS);
      const messages = client.fetch(
        { seen: false, before: olderThan },
        { source: true, envelope: true, uid: true, flags: true },
      );
      const uidsToMarkSeen: number[] = [];

      for await (const message of messages) {
        summary.scannedEmails += 1;

        const subject = message.envelope?.subject || '(no subject)';
        const fromAddress = message.envelope?.from?.[0]?.address;

        uidsToMarkSeen.push(message.uid);

        try {
          const job = await this.findMatchingJob(emailAccountId, subject);
          if (!job) {
            summary.skippedEmails += 1;
            this.logger.warn(
              `Skipped email without matching active job: "${subject}" from ${fromAddress}`,
            );
            continue;
          }

          if (!message.source) {
            summary.skippedEmails += 1;
            this.logger.warn(`Skipped email without source: "${subject}"`);
            continue;
          }

          const parsedMail = await simpleParser(message.source as Buffer);
          const pdfAttachment = parsedMail.attachments?.find(
            (attachment) =>
              attachment.contentType === 'application/pdf' &&
              attachment.size < 5 * 1024 * 1024,
          );

          if (!pdfAttachment) {
            summary.skippedEmails += 1;
            this.logger.warn(`Skipped email without valid PDF: "${subject}"`);
            continue;
          }

          const candidateEmail = parsedMail.from?.value[0]?.address;
          if (!candidateEmail) {
            summary.skippedEmails += 1;
            this.logger.warn(`Skipped email without sender: "${subject}"`);
            continue;
          }

          const created = await this.processApplication(
            candidateEmail,
            pdfAttachment.content,
            job,
          );
          summary.processedEmails += 1;
          if (created) summary.newCandidates += 1;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Email processing failed';
          summary.errors.push(message);
          this.logger.error(`Failed to process email "${subject}":`, error);
        }
      }

      if (uidsToMarkSeen.length > 0) {
        await client.messageFlagsAdd(uidsToMarkSeen, ['\\Seen'], {
          uid: true,
        });
      }
    } finally {
      lock?.release();
    }

    return summary;
  }

  private async findMatchingJob(emailAccountId: string, subject: string) {
    const jobs = await this.prisma.jobDescription.findMany({
      where: {
        emailAccountId,
        isActive: true,
      },
      include: {
        scenarios: {
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (jobs.length === 0) return null;

    const normalizedSubject = this.normalizeForMatch(subject);

    const referenceMatch = jobs.find(
      (job) =>
        job.jobReference &&
        normalizedSubject.includes(this.normalizeForMatch(job.jobReference)),
    );
    if (referenceMatch) return referenceMatch;

    const titleMatch = jobs.find((job) =>
      this.isLikelyTitleMatch(normalizedSubject, job.title),
    );
    if (titleMatch) return titleMatch;

    return jobs.length === 1 ? jobs[0] : null;
  }

  private normalizeForMatch(value: string) {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private isLikelyTitleMatch(normalizedSubject: string, title: string) {
    const normalizedTitle = this.normalizeForMatch(title);
    if (!normalizedTitle) return false;
    if (normalizedSubject.includes(normalizedTitle)) return true;

    const titleWords = normalizedTitle
      .split(' ')
      .filter((word) => word.length >= 3);
    if (titleWords.length === 0) return false;

    const matchedWords = titleWords.filter((word) =>
      normalizedSubject.includes(word),
    );

    return matchedWords.length / titleWords.length >= 0.6;
  }

  private async processApplication(
    candidateEmail: string,
    pdfBuffer: Buffer,
    job: JobForPipeline,
  ): Promise<boolean> {
    const start = Date.now();
    this.logger.log(`[${candidateEmail}] Starting pipeline for ${job.title}.`);

    try {
      const parser = new PDFParse({ data: pdfBuffer });
      let cvText = '';
      try {
        const result = await parser.getText();
        cvText = result.text;
      } catch (parseError) {
        this.logger.error(`[${candidateEmail}] PDF parse error:`, parseError);
        await parser.destroy();
        return false;
      }
      await parser.destroy();

      const { score: matchScore, vectorString } =
        await this.cvScreeningService.evaluateTextMatching(cvText, job.id);

      const githubUrls = this.extractGithubUrls(cvText);
      let techReviewResult: TechReviewPythonResult | null = null;
      let bestRepoUrl = '';

      if (githubUrls.length > 0) {
        for (const url of githubUrls) {
          const currentResult = await this.runTechReviewPython(
            url,
            job.content,
            job.companyId,
          );

          if (
            currentResult &&
            (!techReviewResult ||
              currentResult.overall_score > techReviewResult.overall_score)
          ) {
            techReviewResult = currentResult;
            bestRepoUrl = url;
          }
        }
      }

      const isCvMatch = matchScore >= 70;
      const isTechReviewPass =
        !techReviewResult || techReviewResult.verdict !== 'FAIL';
      const isQualified = isCvMatch && isTechReviewPass;

      if (!isQualified) {
        await this.emailService.sendRejection(candidateEmail, job.title);
        this.logger.log(`[${candidateEmail}] Rejected after screening.`);
        return false;
      }

      const user = await this.prisma.user.upsert({
        where: { email: candidateEmail },
        update: {},
        create: { email: candidateEmail, role: 'CANDIDATE' },
      });

      const application = await this.prisma.application.create({
        data: {
          userId: user.id,
          jobId: job.id,
          cvText,
          matchScore,
          status: 'TESTING',
        },
      });

      await this.prisma.$executeRawUnsafe(`
        UPDATE "Application" SET "cvEmbedding" = '${vectorString}'::vector WHERE id = '${application.id}'
      `);

      if (techReviewResult) {
        const techSummary = `### Tech Review Summary (Best Repo)\n**Source:** ${bestRepoUrl}\n**Verdict:** ${techReviewResult.verdict} (${techReviewResult.overall_score}/10)\n**Seniority Estimate:** ${techReviewResult.seniority_estimate}\n**Job Fit:** ${techReviewResult.job_fit.is_fit ? 'Fit' : 'Not a Fit'}. Reason: ${techReviewResult.job_fit.reason}\n**Architecture:** Pattern: ${techReviewResult.architecture.pattern}. Summary: ${techReviewResult.architecture.summary}.\n**Strengths:**\n- ${techReviewResult.strengths.join('\n- ')}`;

        await this.prisma.assessmentReport.create({
          data: {
            applicationId: application.id,
            summary: techSummary,
            riskFlags: techReviewResult.red_flags as string[],
          },
        });
      }

      if (job.scenarios.length === 0) {
        this.logger.warn(`[${candidateEmail}] Job has no test scenario.`);
        return true;
      }

      const testSessions = await Promise.all(
        job.scenarios.map((scenario) =>
          this.prisma.testSession.create({
            data: {
              applicationId: application.id,
              scenarioId: scenario.id,
            },
            select: { id: true },
          }),
        ),
      );

      const testLink = `${envConfig.FRONTEND_URL}/tests/${testSessions[0].id}`;
      await this.emailService.sendTestInvitation(
        candidateEmail,
        testLink,
        job.title,
      );

      const duration = Date.now() - start;
      this.logger.log(
        `[${candidateEmail}] Pipeline completed in ${duration}ms.`,
      );
      return true;
    } catch (error) {
      this.logger.error(`[${candidateEmail}] Pipeline failed:`, error);
      return false;
    }
  }

  private extractGithubUrls(text: string): string[] {
    const repoRegex =
      /https?:\/\/(?:www\.)?github\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+/gi;
    const repoMatches = text.match(repoRegex);

    if (repoMatches?.length) {
      return [...new Set(repoMatches)].slice(0, 3);
    }

    return [];
  }

  private async runTechReviewPython(
    githubUrl: string,
    jobDescription: string,
    companyId: string,
  ): Promise<TechReviewPythonResult | null> {
    return new Promise((resolve) => {
      const scriptPath = path.join(
        process.cwd(),
        'src',
        'shared',
        'scripts',
        'tech_review_agentv3.1.py',
      );

      this.aiService
        .resolveApiKey(companyId)
        .then((apiKey) => {
          const pythonProcess = spawn(
            'python',
            [
              scriptPath,
              '--github',
              githubUrl,
              '--key',
              apiKey,
              '--job',
              jobDescription,
            ],
            {
              env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
            },
          );

          let stdoutData = '';
          let stderrData = '';

          pythonProcess.stdout.on('data', (data) => {
            stdoutData += data.toString();
          });

          pythonProcess.stderr.on('data', (data) => {
            stderrData += data.toString();
          });

          pythonProcess.on('close', (code) => {
            if (stderrData) {
              this.logger.debug(
                `[Python Agent Progress]:\n${stderrData.trim()}`,
              );
            }

            if (code !== 0) {
              this.logger.error(`Python review exited with code ${code}`);
              return resolve(null);
            }

            try {
              this.aiService
                .recordExternalUsage(companyId, jobDescription, stdoutData)
                .catch((error) => {
                  this.logger.warn(
                    'Could not record Python review usage:',
                    error,
                  );
                });
              return resolve(JSON.parse(stdoutData.trim()));
            } catch (error) {
              const message =
                error instanceof Error ? error.message : 'Unknown JSON error';
              this.logger.error(`Python review JSON parse failed: ${message}`);
              this.logger.error(`Raw stdout: ${stdoutData}`);
              return resolve(null);
            }
          });
        })
        .catch((error) => {
          this.logger.error(
            'Could not resolve AI key for Python review:',
            error,
          );
          resolve(null);
        });
    });
  }
}
