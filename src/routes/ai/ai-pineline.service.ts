/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from 'src/shared/services/prisma.service';
import { GoogleGenerativeAI } from '@google/generative-ai';
import envConfig from 'src/shared/config';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { CvScreeningService } from './ai-cv-screening.service';
import { EmailService } from 'src/shared/services/mail.service';
import { PDFParse } from 'pdf-parse';

interface GithubRepo {
  name: string;
  language: string | null;
  description: string | null;
}

interface IntegrityReport {
  integrityScore: number;
  analysis: string;
  redFlags: string[];
}

interface HrEmailConfig {
  email: string;
  appPassword: string;
}

@Injectable()
export class AiPipelineService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiPipelineService.name);
  private genAI: GoogleGenerativeAI;
  private imapClients: Map<string, ImapFlow> = new Map();

  constructor(
    private prisma: PrismaService,
    private cvScreeningService: CvScreeningService,
    private emailService: EmailService,
  ) {
    this.genAI = new GoogleGenerativeAI(envConfig.SECRET_API_KEY);
  }

  async onModuleInit() {
    let hrAccounts: HrEmailConfig[] = [];
    try {
      const accountsJson = envConfig.HR_ACCOUNTS;
      hrAccounts = JSON.parse(accountsJson) as HrEmailConfig[];
    } catch (e) {
      this.logger.error(
        '❌ Cấu hình HR_ACCOUNTS trong .env bị lỗi format JSON',
      );
      return;
    }

    if (hrAccounts.length === 0) {
      this.logger.warn('⚠️ Chưa có email HR nào được cấu hình!');
      return;
    }

    for (const account of hrAccounts) {
      const client = new ImapFlow({
        host: envConfig.IMAP_HOST,
        port: envConfig.IMAP_PORT || 993,
        secure: true,
        auth: {
          user: account.email,
          pass: account.appPassword,
        },
        logger: false,
      });

      try {
        await client.connect();
        this.imapClients.set(account.email, client);
        this.logger.log(`✅ IMAP connected: ${account.email}`);
      } catch (error) {
        this.logger.error(
          `❌ IMAP connection failed for ${account.email}:`,
          error,
        );
      }
    }
  }

  async onModuleDestroy() {
    for (const [email, client] of this.imapClients.entries()) {
      try {
        await client.logout();
        this.logger.log(`👋 IMAP disconnected: ${email}`);
      } catch (error) {
        this.logger.warn(`⚠️ Error during IMAP logout for ${email}:`, error);
      }
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleIncomingApplications() {
    if (this.imapClients.size === 0) return;
    this.logger.log('🔍 Bắt đầu quét email...');

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    for (const [hrEmail, client] of this.imapClients.entries()) {
      let lock;
      try {
        lock = await client.getMailboxLock('INBOX');

        const unseenStatus = await client.status('INBOX', { unseen: true });
        this.logger.log(`📬 [${hrEmail}] Unread count: ${unseenStatus.unseen}`);

        const messages = client.fetch(
          { seen: false, since: startOfMonth },
          { source: true, envelope: true, uid: true, flags: true },
        );

        const uidsToMarkSeen: number[] = [];

        for await (const message of messages) {
          try {
            const envelope = message.envelope;
            const subject = envelope?.subject || '(no subject)';
            const emailDate = envelope?.date;
            const fromAddress = envelope?.from?.[0]?.address;

            this.logger.debug(
              `📧 [${hrEmail}] Checking: "${subject}" from ${fromAddress} (${emailDate})`,
            );

            if (!emailDate) {
              this.logger.warn(
                `⚠️ [${hrEmail}] Skipping email without date: "${subject}"`,
              );
              continue;
            }

            if (new Date(emailDate) < startOfMonth) {
              this.logger.debug(
                `⏳ [${hrEmail}] Skipping old email (before ${startOfMonth.toISOString()}): ${emailDate.toISOString()}`,
              );
              continue;
            }

            if (!subject.toLowerCase().includes('ứng tuyển việc làm')) {
              this.logger.debug(
                `❌ [${hrEmail}] Subject mismatch: "${subject}"`,
              );
              continue;
            }

            this.logger.log(
              `✅ [${hrEmail}] Valid application email: "${subject}"`,
            );

            uidsToMarkSeen.push(message.uid);

            if (!message.source) {
              this.logger.warn(
                `⚠️ [${hrEmail}] No source content in email: "${subject}"`,
              );
              continue;
            }

            const parsedMail = await simpleParser(message.source as Buffer);
            const pdfAttachment = parsedMail.attachments?.find(
              (att) =>
                att.contentType === 'application/pdf' &&
                att.size < 5 * 1024 * 1024,
            );

            if (!pdfAttachment) {
              this.logger.warn(
                `⚠️ [${hrEmail}] No valid PDF attachment in email: "${subject}"`,
              );
              continue;
            }

            const candidateEmail = parsedMail.from?.value[0]?.address;
            if (!candidateEmail) {
              this.logger.warn(
                `⚠️ [${hrEmail}] Could not determine sender email: "${subject}"`,
              );
              continue;
            }

            this.logger.log(
              `🚀 [${hrEmail}] Processing CV from ${candidateEmail}`,
            );

            await this.processApplication(
              candidateEmail,
              hrEmail,
              pdfAttachment.content,
            );
          } catch (innerError) {
            this.logger.error(
              `💥 [${hrEmail}] Error processing individual email:`,
              innerError,
            );
          }
        }

        if (uidsToMarkSeen.length > 0) {
          await client.messageFlagsAdd(uidsToMarkSeen, ['\\Seen'], {
            uid: true,
          });
          this.logger.log(
            `✅ [${hrEmail}] Đã mark seen hoàn tất ${uidsToMarkSeen.length} email thành công!`,
          );
        }
      } catch (error) {
        this.logger.error(`💥 [${hrEmail}] Error scanning mailbox:`, error);
      } finally {
        lock?.release();
      }
    }
    this.logger.log('🏁 Finished scanning all mailboxes');
  }

  private async processApplication(
    candidateEmail: string,
    hrEmail: string,
    pdfBuffer: Buffer,
  ): Promise<void> {
    const start = Date.now();
    this.logger.log(`⏳ [${candidateEmail}] Starting pipeline...`);

    try {
      const job = await this.prisma.jobDescription.findUnique({
        where: { hrEmail: hrEmail },
        include: { scenarios: true },
      });
      if (!job) {
        this.logger.warn(
          `❌ [${candidateEmail}] No job found for HR email: ${hrEmail}`,
        );
        return;
      }
      this.logger.log(`📋 [${candidateEmail}] Job: ${job.title}`);

      // ✅ 2. Parse PDF với API mới (PDFParse)
      const parser = new PDFParse({ data: pdfBuffer });
      let cvText = '';
      try {
        const result = await parser.getText();
        cvText = result.text;
        this.logger.log(
          `📄 [${candidateEmail}] PDF parsed (${cvText.length} chars)`,
        );
      } catch (parseError) {
        this.logger.error(
          `❌ [${candidateEmail}] PDF parse error:`,
          parseError,
        );
        await parser.destroy();
        return;
      }
      await parser.destroy();

      const user = await this.prisma.user.upsert({
        where: { email: candidateEmail },
        update: {},
        create: { email: candidateEmail, role: 'CANDIDATE' },
      });
      const application = await this.prisma.application.create({
        data: {
          userId: user.id,
          jobId: job.id,
          cvText: cvText,
          status: 'SCREENING',
        },
      });
      this.logger.log(
        `👤 [${candidateEmail}] Application created: ${application.id}`,
      );

      const githubUsername = this.extractGithubUsername(cvText);
      let githubAnalysisResult: IntegrityReport | null = null;

      if (githubUsername) {
        this.logger.log(
          `🐙 [${candidateEmail}] GitHub username found: ${githubUsername}`,
        );
        const githubStats = await this.fetchGitHubStats(githubUsername);
        const sourceCodeInfo = await this.fetchGitHubSourceCode(githubUsername);

        if (githubStats.length > 0) {
          this.logger.log(
            `🤖 [${candidateEmail}] Calling AI for integrity analysis...`,
          );
          githubAnalysisResult = await this.evaluateProfileIntegrity(
            cvText,
            githubStats,
            sourceCodeInfo,
          );

          if (githubAnalysisResult) {
            await this.prisma.assessmentReport.create({
              data: {
                applicationId: application.id,
                summary: githubAnalysisResult.analysis,
                riskFlags: githubAnalysisResult.redFlags as any,
              },
            });
            this.logger.log(
              `📊 [${candidateEmail}] Integrity score: ${githubAnalysisResult.integrityScore}`,
            );
          }
        } else {
          this.logger.warn(
            `⚠️ [${candidateEmail}] No public GitHub repos found`,
          );
        }
      } else {
        this.logger.log(`ℹ️ [${candidateEmail}] No GitHub link in CV`);
      }

      this.logger.log(`🎯 [${candidateEmail}] Calculating CV match score...`);
      const matchScore = await this.cvScreeningService.evaluateCvMatching(
        application.id,
      );
      this.logger.log(`📈 [${candidateEmail}] Match score: ${matchScore}%`);

      const updatedApp = await this.prisma.application.findUnique({
        where: { id: application.id },
        include: { job: true, testSession: true },
      });
      if (!updatedApp) {
        this.logger.error(
          `❌ [${candidateEmail}] Application disappeared after update`,
        );
        return;
      }

      const MATCH_THRESHOLD = 70;
      const INTEGRITY_THRESHOLD = 60;
      const integrityScore = githubAnalysisResult?.integrityScore ?? 100;
      const isQualified =
        (updatedApp.matchScore ?? 0) >= MATCH_THRESHOLD &&
        integrityScore >= INTEGRITY_THRESHOLD;

      this.logger.log(
        `⚖️ [${candidateEmail}] Qualified: ${isQualified} (match: ${updatedApp.matchScore}, integrity: ${integrityScore})`,
      );

      if (isQualified && job.scenarios.length > 0) {
        if (!updatedApp.testSession) {
          const testSession = await this.prisma.testSession.create({
            data: {
              applicationId: application.id,
              scenarioId: job.scenarios[0].id,
            },
          });
          updatedApp.testSession = testSession;
        }

        if (updatedApp.status !== 'TESTING') {
          await this.prisma.application.update({
            where: { id: application.id },
            data: { status: 'TESTING' },
          });
        }

        const testLink = `${envConfig.FRONTEND_URL}/tests/${updatedApp.testSession.id}`;
        await this.emailService.sendTestInvitation(
          candidateEmail,
          testLink,
          job.title,
        );
        this.logger.log(`✅ [${candidateEmail}] Invitation email sent`);
      } else {
        await this.prisma.application.update({
          where: { id: application.id },
          data: { status: 'REJECTED' },
        });
        await this.emailService.sendRejection(candidateEmail, job.title);
        this.logger.log(`❌ [${candidateEmail}] Rejection email sent`);
      }

      const duration = Date.now() - start;
      this.logger.log(
        `🎉 [${candidateEmail}] Pipeline completed in ${duration}ms`,
      );
    } catch (error) {
      const duration = Date.now() - start;
      this.logger.error(
        `💥 [${candidateEmail}] Pipeline failed after ${duration}ms:`,
        error,
      );
    }
  }

  private extractGithubUsername(text: string): string | null {
    const githubRegex = /https?:\/\/(www\.)?github\.com\/([a-zA-Z0-9_-]+)/i;
    const match = text.match(githubRegex);
    return match ? match[2] : null;
  }

  private async fetchGitHubStats(username: string): Promise<GithubRepo[]> {
    try {
      const response = await fetch(
        `https://api.github.com/users/${username}/repos?sort=updated&per_page=5`,
      );
      if (!response.ok) return [];
      const repos = (await response.json()) as Array<{
        name: string;
        language: string;
        description: string;
      }>;
      return repos.map((repo) => ({
        name: repo.name,
        language: repo.language || null,
        description: repo.description || null,
      }));
    } catch (error) {
      this.logger.warn(`Lỗi fetch GitHub stats cho ${username}`);
      return [];
    }
  }

  private async fetchGitHubSourceCode(username: string): Promise<string> {
    try {
      const repoRes = await fetch(
        `https://api.github.com/users/${username}/repos?sort=updated&per_page=1`,
      );
      const repos = await repoRes.json();
      if (!repos || repos.length === 0) return 'Không có public repo.';

      const latestRepo = repos[0].name;

      const readmeRes = await fetch(
        `https://api.github.com/repos/${username}/${latestRepo}/readme`,
        { headers: { Accept: 'application/vnd.github.v3.raw' } },
      );
      const readmeContent = readmeRes.ok
        ? await readmeRes.text()
        : 'Không có README.';

      const treeRes = await fetch(
        `https://api.github.com/repos/${username}/${latestRepo}/git/trees/main?recursive=1`,
      );
      const treeData = await treeRes.json();

      let fileStructure = '';
      if (treeData.tree) {
        const filteredPaths = treeData.tree
          .map((t: { path: string }) => t.path)
          .filter((path: string) => {
            if (
              path.includes('node_modules') ||
              path.includes('.git') ||
              path.includes('dist') ||
              path.includes('build') ||
              path.includes('src/generated') ||
              path.includes('prisma/migrations')
            )
              return false;
            if (path.endsWith('.spec.ts') || path.endsWith('.test.ts'))
              return false;
            const isRootConfigFile =
              /^[^/]+\.(json|yaml|yml|js|config\.js|lock|md|env.*)$/i.test(
                path,
              );
            if (isRootConfigFile && path !== 'package.json') return false;
            const isInMainFolders =
              path.startsWith('src/') ||
              path.startsWith('app/') ||
              path.startsWith('lib/');
            const isSourceCode =
              /\.(ts|tsx|js|jsx|py|java|go|php|cs|cpp|c)$/i.test(path);
            return isInMainFolders || isSourceCode || path === 'package.json';
          });
        fileStructure = filteredPaths.slice(0, 100).join('\n');
      }

      return `
        - Repo: ${latestRepo}
        - Cấu trúc thư mục mã nguồn lõi:
        ${fileStructure}
        
        - Nội dung README:
        ${readmeContent}
      `;
    } catch (error) {
      this.logger.warn(`Không thể lấy source code của ${username}`);
      return 'Lỗi khi truy xuất mã nguồn.';
    }
  }

  private async evaluateProfileIntegrity(
    cvText: string,
    githubStats: GithubRepo[],
    sourceCodeInfo: string,
  ): Promise<IntegrityReport | null> {
    const model = this.genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      generationConfig: { responseMimeType: 'application/json' },
    });

    const truncatedCv = cvText.slice(0, 2000);
    const truncatedSource = sourceCodeInfo.slice(0, 3000);

    const prompt = `
      Bạn là một Technical Lead. Hãy đánh giá tính toàn vẹn của ứng viên dựa trên:
      1. CV: """${truncatedCv}"""
      2. Thông tin GitHub repo: """${JSON.stringify(githubStats)}"""
      3. Chi tiết mã nguồn (cấu trúc thư mục + README): """${truncatedSource}"""

      Nhiệm vụ:
      - So sánh kinh nghiệm trong CV với chất lượng thực tế từ GitHub.
      - Đưa ra điểm integrityScore (0-100).
      - Liệt kê các redFlags (nếu có, ví dụ: "Không có dự án thực tế nào", "README rỗng", "CV phóng đại kinh nghiệm").

      Trả về CHÍNH XÁC định dạng JSON:
      {
        "integrityScore": number,
        "analysis": "tóm tắt phát hiện",
        "redFlags": ["cờ đỏ 1", "cờ đỏ 2"]
      }
    `;

    try {
      const result = await model.generateContent(prompt);
      const jsonString = result.response.text();
      const parsedData = JSON.parse(jsonString) as IntegrityReport;
      return parsedData;
    } catch (error) {
      this.logger.error('Lỗi khi AI phân tích integrity:', error);
      return {
        integrityScore: 50,
        analysis: 'Không thể phân tích do lỗi AI.',
        redFlags: ['Lỗi hệ thống khi đánh giá'],
      };
    }
  }

  private extractGithubRepoUrls(text: string): string[] {
    // Regex khớp với các dạng URL GitHub repo:
    // https://github.com/user/repo
    // http://github.com/user/repo
    // github.com/user/repo
    const repoRegex =
      /(?:https?:\/\/)?(?:www\.)?github\.com\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)/gi;
    const matches = text.matchAll(repoRegex);
    const urls: string[] = [];
    for (const match of matches) {
      // match[0] là URL đầy đủ (có thể thiếu protocol)
      let url = match[0];
      if (!url.startsWith('http')) {
        url = 'https://' + url;
      }
      urls.push(url);
    }
    // Loại bỏ trùng lặp
    return [...new Set(urls)];
  }
}
