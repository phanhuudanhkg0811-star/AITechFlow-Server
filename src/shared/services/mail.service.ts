import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import envConfig from '../config';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: envConfig.SMTP_HOST,
      port: envConfig.SMTP_PORT,
      secure: envConfig.SMTP_PORT === 465,
      auth: {
        user: envConfig.SMTP_USER,
        pass: envConfig.SMTP_PASS,
      },
    });
  }

  async sendMail(to: string, subject: string, html: string): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: envConfig.EMAIL_FROM,
        to,
        subject,
        html,
      });
      this.logger.log(`Email sent to ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}`, error);
    }
  }

  sendTestInvitation(email: string, testLink: string, jobTitle: string) {
    const subject = `[AI-TechFlow] Mời bạn tham gia bài test cho vị trí ${jobTitle}`;
    const html = `
      <h3>Chúc mừng bạn đã vượt qua vòng sàng lọc CV!</h3>
      <p>Vị trí ứng tuyển: <strong>${jobTitle}</strong></p>
      <p>Vui lòng truy cập link bên dưới để làm bài test trên Web-IDE của chúng tôi:</p>
      <p><a href="${testLink}">${testLink}</a></p>
      <p>Bài test sẽ tự động đánh giá năng lực của bạn. Chúc bạn làm bài tốt!</p>
      <br/>
      <p>Trân trọng,<br/>Đội ngũ AI-TechFlow</p>
    `;
    return this.sendMail(email, subject, html);
  }

  sendRejection(email: string, jobTitle: string) {
    const subject = `[AI-TechFlow] Cập nhật hồ sơ ứng tuyển vị trí ${jobTitle}`;
    const html = `
      <h3>Cảm ơn bạn đã quan tâm đến cơ hội tại AI-TechFlow</h3>
      <p>Vị trí ứng tuyển: <strong>${jobTitle}</strong></p>
      <p>Sau khi xem xét kỹ lưỡng hồ sơ của bạn, chúng tôi rất tiếc phải thông báo rằng bạn chưa phù hợp với yêu cầu của vị trí này vào thời điểm hiện tại.</p>
      <p>Chúng tôi sẽ lưu lại thông tin của bạn và sẽ liên hệ nếu có cơ hội phù hợp hơn trong tương lai.</p>
      <br/>
      <p>Chúc bạn thành công trên con đường sự nghiệp!</p>
      <p>Trân trọng,<br/>Đội ngũ AI-TechFlow</p>
    `;
    return this.sendMail(email, subject, html);
  }
}
