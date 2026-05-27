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
import path from 'node:path';
import { spawn } from 'node:child_process';

interface HrEmailConfig {
  email: string;
  appPassword: string;
}

// Định nghĩa cấu trúc JSON trả về từ file tech_review_agentv3.1.py
interface TechReviewPythonResult {
  verdict: 'PASS' | 'FAIL' | 'BORDERLINE';
  overall_score: number; // Điểm hệ 10 từ script Python
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

    // Gọi hàm kết nối cho từng tài khoản
    for (const account of hrAccounts) {
      await this.connectImap(account);
    }
  }

  private async connectImap(account: HrEmailConfig) {
    const client = new ImapFlow({
      host: envConfig.IMAP_HOST || 'imap.gmail.com',
      port: envConfig.IMAP_PORT || 993,
      secure: true,
      auth: {
        user: account.email,
        pass: account.appPassword,
      },
      logger: false,
      socketTimeout: 0,
      connectionTimeout: 30000,
    });

    // 1. Hứng lỗi ngầm để chống sập server
    client.on('error', (error) => {
      this.logger.error(
        `❌ IMAP Background Error [${account.email}]: ${error.message}`,
      );
    });

    // 2. Lắng nghe sự kiện mất kết nối để TỰ ĐỘNG RECONNECT
    client.on('close', () => {
      this.logger.warn(
        `⚠️ Mất kết nối IMAP [${account.email}]. Đang thử kết nối lại sau 10 giây...`,
      );

      // Xóa client cũ đã chết khỏi Map
      this.imapClients.delete(account.email);

      // Đợi 10 giây rồi gọi lại chính hàm này để tạo kết nối mới
      setTimeout(() => {
        this.connectImap(account).catch((err) => {
          this.logger.error(
            `❌ Lỗi khi thử kết nối lại [${account.email}]:`,
            err,
          );
        });
      }, 10000);
    });

    // 3. Thực hiện kết nối
    try {
      await client.connect();
      this.imapClients.set(account.email, client);
      this.logger.log(`✅ IMAP connected: ${account.email}`);
    } catch (error) {
      this.logger.error(
        `❌ IMAP connection failed for ${account.email}:`,
        error,
      );

      // Nếu ngay lần đầu kết nối đã thất bại (ví dụ sai pass, đứt mạng),
      // cũng kích hoạt thử lại sau 10 giây
      setTimeout(() => {
        this.connectImap(account).catch((e) => console.error(e));
      }, 10000);
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

  @Cron(CronExpression.EVERY_10_MINUTES)
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

      // 1. Parse PDF
      const parser = new PDFParse({ data: pdfBuffer });
      let cvText = '';
      try {
        const result = await parser.getText();
        cvText = result.text;
      } catch (parseError) {
        this.logger.error(
          `❌ [${candidateEmail}] PDF parse error:`,
          parseError,
        );
        await parser.destroy();
        return;
      }
      await parser.destroy();

      // 2. Chấm điểm Github Integrity (Giữ nguyên logic cũ của bạn)
      this.logger.log(`🎯 [${candidateEmail}] Calculating CV match score...`);
      const { score: matchScore, vectorString } =
        await this.cvScreeningService.evaluateTextMatching(cvText, job.id);
      this.logger.log(`📈 [${candidateEmail}] Match score: ${matchScore}%`);

      // 3. Chạy Python Agent để review code (nếu có Github)
      const githubUrls = this.extractGithubUrls(cvText);
      let techReviewResult: TechReviewPythonResult | null = null;
      let bestRepoUrl = '';

      if (githubUrls.length > 0) {
        this.logger.log(
          `🤖 [${candidateEmail}] Tìm thấy ${githubUrls.length} repo. Bắt đầu phân tích tìm repo tốt nhất...`,
        );

        // Duyệt qua từng link (chạy tuần tự để tránh chạm giới hạn API Rate Limit của Gemini)
        for (const url of githubUrls) {
          const currentResult = await this.runTechReviewPython(
            url,
            job.content,
          );

          if (currentResult) {
            this.logger.log(
              `Repo [${url}] đạt ${currentResult.overall_score}/10 điểm.`,
            );

            // Nếu chưa có kết quả nào, hoặc kết quả repo này cao điểm hơn repo trước đó
            if (
              !techReviewResult ||
              currentResult.overall_score > techReviewResult.overall_score
            ) {
              techReviewResult = currentResult;
              bestRepoUrl = url;
            }
          }
        }

        if (techReviewResult) {
          this.logger.log(
            `🏆 [${candidateEmail}] Đã chọn Repo xuất sắc nhất: ${bestRepoUrl} (Điểm: ${techReviewResult.overall_score}/10)`,
          );
        } else {
          this.logger.warn(
            `⚠️ [${candidateEmail}] Không phân tích thành công repo nào trong danh sách.`,
          );
        }
      }

      // 4. Quyết định Đậu / Rớt
      const MATCH_THRESHOLD = 70;
      const isCvMatch = matchScore >= MATCH_THRESHOLD;
      // Chỉ cần pass vòng CV và không bị FAIL vòng code là được
      const isTechReviewPass =
        !techReviewResult || techReviewResult.verdict !== 'FAIL';
      const isQualified = isCvMatch && isTechReviewPass;

      this.logger.log(
        `⚖️ [${candidateEmail}] CV Match: ${isCvMatch} (${matchScore}%)`,
      );
      this.logger.log(
        `⚖️ [${candidateEmail}] Tech Review: ${
          techReviewResult ? techReviewResult.verdict : 'N/A'
        }`,
      );
      this.logger.log(`⚖️ [${candidateEmail}] Qualified: ${isQualified}`);

      if (isQualified) {
        // NẾU ĐẬU: Mới bắt đầu tạo User, Application, Report, TestSession vào DB
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
            matchScore: matchScore,
            status: 'TESTING', // Pass thẳng vòng gửi xe, vô luôn TESTING
          },
        });

        // Cập nhật Vector 3072 vào Application
        await this.prisma.$executeRawUnsafe(`
          UPDATE "Application" SET "cvEmbedding" = '${vectorString}'::vector WHERE id = '${application.id}'
        `);

        // Lưu Report đánh giá Github từ Python Agent
        if (techReviewResult) {
          const techSummary = `### Tech Review Summary (Best Repo)\n**Nguồn:** ${bestRepoUrl}\n**Verdict:** ${techReviewResult.verdict} (${techReviewResult.overall_score}/10)\n**Seniority Estimate:** ${techReviewResult.seniority_estimate}\n**Job Fit:** ${techReviewResult.job_fit.is_fit ? 'Fit' : 'Not a Fit'}. Reason: ${techReviewResult.job_fit.reason}\n**Architecture:** Pattern: ${techReviewResult.architecture.pattern}. Summary: ${techReviewResult.architecture.summary}.\n**Strengths:**\n- ${techReviewResult.strengths.join('\n- ')}`;

          await this.prisma.assessmentReport.create({
            data: {
              applicationId: application.id,
              summary: techSummary,
              riskFlags: techReviewResult.red_flags as any,
            },
          });
        }

        // Tạo Session & Gửi mail mời thi
        if (job.scenarios.length > 0) {
          const testSession = await this.prisma.testSession.create({
            data: {
              applicationId: application.id,
              scenarioId: job.scenarios[0].id,
            },
          });
          const testLink = `${envConfig.FRONTEND_URL}/tests/${testSession.id}`;
          await this.emailService.sendTestInvitation(
            candidateEmail,
            testLink,
            job.title,
          );
          this.logger.log(
            `✅ [${candidateEmail}] Tạo Account thành công. Đã gửi Invitation email.`,
          );
        }
      } else {
        // NẾU RỚT: Bỏ qua bước tạo User & Application, từ chối thẳng
        await this.emailService.sendRejection(candidateEmail, job.title);
        this.logger.log(
          `❌ [${candidateEmail}] Ứng viên không đạt chuẩn. Đã gửi Rejection email và KHÔNG tạo Account.`,
        );
      }

      const duration = Date.now() - start;
      this.logger.log(
        `🎉 [${candidateEmail}] Pipeline completed in ${duration}ms`,
      );
    } catch (error) {
      this.logger.error(`💥 [${candidateEmail}] Pipeline failed:`, error);
    }
  }

  private extractGithubUrls(text: string): string[] {
    const repoRegex =
      /https?:\/\/(?:www\.)?github\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+/gi;
    const repoMatches = text.match(repoRegex);

    if (repoMatches && repoMatches.length > 0) {
      // Bỏ trùng lặp và CHỈ LẤY TỐI ĐA 3 LINK đầu tiên
      const uniqueRepos = [...new Set(repoMatches)].slice(0, 3);
      this.logger.log(
        `🔍 Tìm thấy các link Github Repo hợp lệ: ${uniqueRepos.join(', ')}`,
      );
      return uniqueRepos;
    }

    const profileRegex = /https?:\/\/(?:www\.)?github\.com\/[a-zA-Z0-9_-]+/i;
    const profileMatch = text.match(profileRegex);
    if (profileMatch) {
      this.logger.warn(
        `⚠️ Ứng viên để link Profile (${profileMatch[0]}) nhưng không có Repo cụ thể.`,
      );
    }

    return []; // Trả về mảng rỗng nếu không có link repo nào
  }

  private async runTechReviewPython(
    githubUrl: string,
    jobDescription: string,
  ): Promise<TechReviewPythonResult | null> {
    return new Promise((resolve) => {
      // Xác định đường dẫn tuyệt đối đến thư mục src/shared/scripts
      const scriptPath = path.join(
        process.cwd(),
        'src',
        'shared',
        'scripts',
        'tech_review_agentv3.1.py',
      );

      // Lấy API Key từ biến môi trường (Hoặc dùng ConfigService tùy dự án của bạn)
      const apiKey = envConfig.SECRET_API_KEY;

      this.logger.log(
        `🐍 [Python Spawn] Đang kích hoạt Review Agent cho repo: ${githubUrl}`,
      );

      // Sử dụng spawn truyền đối số mảng để chống lỗ hổng Command Injection
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

      // Đọc luồng dữ liệu JSON kết quả (stdout)
      pythonProcess.stdout.on('data', (data) => {
        stdoutData += data.toString();
      });

      // Đọc luồng hiển thị tiến trình, log debug hoặc lỗi (stderr)
      pythonProcess.stderr.on('data', (data) => {
        stderrData += data.toString();
      });

      // Xử lý khi script chạy xong hoàn toàn
      pythonProcess.on('close', (code) => {
        // Đẩy toàn bộ log tiến trình của Python vào Terminal của NestJS để dễ dàng theo dõi
        if (stderrData) {
          this.logger.debug(`[Python Agent Progress]:\n${stderrData.trim()}`);
        }

        if (code !== 0) {
          this.logger.error(`❌ Script Python kết thúc với mã lỗi: ${code}`);
          return resolve(null);
        }

        try {
          // Parse dòng kết quả JSON duy nhất từ stdout
          const cleanJson: TechReviewPythonResult = JSON.parse(
            stdoutData.trim(),
          );
          return resolve(cleanJson);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown Error';
          this.logger.error(
            `❌ Lỗi đồng bộ cấu trúc JSON từ Python: ${errorMessage}`,
          );
          this.logger.error(`Dữ liệu thô nhận được: ${stdoutData}`);
          return resolve(null);
        }
      });
    });
  }
}
