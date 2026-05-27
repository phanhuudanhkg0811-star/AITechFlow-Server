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

  // THÊM: Phương thức gửi email chúc mừng đậu bài test
  sendTestPassedCongratulation(email: string, name: string, score: number) {
    const subject = `[AI-TechFlow] Chúc mừng bạn đã hoàn thành xuất sắc bài kiểm tra kỹ thuật!`;
    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px;">
        <h2 style="color: #4f46e5;">Chúc mừng, ${name}!</h2>
        <p>Hệ thống đánh giá tự động <b>AI-TechFlow</b> xin thông báo bài làm Web-IDE của bạn đã được chấm điểm hoàn tất.</p>
        <p>Kết quả phân tích mã nguồn của bạn đã đạt yêu cầu kỹ thuật từ đội ngũ Tech Lead của chúng tôi với điểm số ấn tượng: <b>${score}/100 điểm</b>.</p>
        <div style="background-color: #f5f3ff; padding: 15px; border-left: 4px solid #7c3aed; margin: 20px 0;">
          <p style="margin: 0; font-weight: bold; color: #6d28d9;">Bước tiếp theo:</p>
          <p style="margin: 5px 0 0 0;">Bộ phận HR sẽ liên hệ với bạn trong vòng 24-48 giờ tới để sắp xếp một buổi phỏng vấn trực tiếp (vòng Interview) cùng với Tech Lead.</p>
        </div>
        <p>Cảm ơn bạn đã dành thời gian tham gia thử thách công nghệ của AI-TechFlow!</p>
        <br/>
        <p style="font-size: 12px; color: #6b7280;">Đây là email tự động từ hệ thống AI-TechFlow Screening Pipeline.</p>
      </div>
    `;
    return this.sendMail(email, subject, html);
  }
}
