<div align="center">
  <img src="https://raw.githubusercontent.com/lucide-react/lucide/main/icons/cpu.svg" width="80" height="80" />
  <h1>⚙️ AI-TechFlow Backend Core</h1>
  <p><b>The Orchestration Engine for AI-Driven Recruitment</b></p>

  <p>
    <img src="https://img.shields.io/badge/Framework-NestJS_11-E0234E?style=flat-square&logo=nestjs" />
    <img src="https://img.shields.io/badge/Database-PostgreSQL_%2B_pgvector-316192?style=flat-square&logo=postgresql" />
    <img src="https://img.shields.io/badge/ORM-Prisma-2D3748?style=flat-square&logo=prisma" />
    <img src="https://img.shields.io/badge/AI-Google_Gemini_Pro-8E75B2?style=flat-square&logo=googlebard" />
    <img src="https://img.shields.io/badge/Security-JWT_%2B_Cookies-black?style=flat-square" />
  </p>

  <p><i>Hệ thống lõi điều phối quy trình tuyển dụng tự động, xử lý Vector Embedding và phân tích mã nguồn ứng viên.</i></p>
</div>

---

## 🏗️ Kiến trúc Hệ thống

Backend được xây dựng theo kiến trúc **Modular Design** của NestJS, đảm bảo tính mở rộng và dễ dàng bảo trì.

### 🛰️ Các Module chính
* **Auth Module:** Xử lý xác thực OAuth2 qua GitHub, quản lý Session và xoay vòng JWT (Access/Refresh Token) qua HTTP-only Cookies để bảo mật tối đa.
* **AI Module:** "Bộ não" của hệ thống, điều phối các yêu cầu đến Google Gemini API (Suggestion, Quick Edit, Embedding).
* **Job & Application Module:** Quản lý vòng đời của tin tuyển dụng và hồ sơ ứng viên, tích hợp tính toán độ tương quan Vector.
* **Test & Conversation Module:** Quản lý phiên làm bài thi Web-IDE và hệ thống Chatbot hỗ trợ ứng viên dựa trên ngữ cảnh mã nguồn (Context-Aware).
* **Shared Module:** Cung cấp các dịch vụ dùng chung như Prisma, Mailer và các Guards bảo mật.

---

## 🧠 AI Pipeline & Vector Processing (Deep Dive)

Đây là phần "ngầu" nhất của hệ thống, nơi AI thực sự thay thế con người trong các tác vụ lặp đi lặp lại.

### 🧬 Quy trình Sàng lọc Vector (Vector Screening)
Hệ thống sử dụng model `gemini-embedding-001` để chuyển đổi mô tả công việc (JD) và nội dung CV thành các Vector 3072 chiều. 
* Phép toán **Cosine Similarity** (`<=>`) được thực hiện trực tiếp trong PostgreSQL thông qua `pgvector` để tìm ra độ tương đồng chính xác nhất giữa ứng viên và yêu cầu.

### 🤖 Agentic Pipeline (Background Job)
Dịch vụ `AiPipelineService` chạy định kỳ (Cronjob) để thực hiện chuỗi hành động:
1.  **IMAP Sync:** Kết nối đến hòm thư HR qua giao thức IMAP để quét email ứng tuyển mới.
2.  **PDF Parsing:** Trích xuất văn bản từ CV PDF đính kèm.
3.  **GitHub Integrity Check:** AI tự động truy cập GitHub của ứng viên, phân tích `README` và cấu trúc mã nguồn để đánh giá tính thực chiến (Integrity Score).
4.  **Auto-Invitation:** Nếu điểm Match Score đạt ngưỡng, hệ thống tự động tạo User, Test Session và gửi email mời thi qua SMTP.

---

## 🛠️ Tech Stack & Cấu trúc Dữ liệu

* **Runtime:** Node.js (TypeScript).
* **Database Schema (Prisma):** * Sử dụng `Unsupported("vector(3072)")` để hỗ trợ lưu trữ Vector Embedding.
    * Hỗ trợ quan hệ Cascade: Khi xóa một Job, các Scenarios và Applications liên quan sẽ được dọn dẹp sạch sẽ.
* **Validation:** Toàn bộ dữ liệu đầu vào được kiểm soát chặt chẽ bởi `Zod` thông qua `CustomZodValidationPipe`.

---

## 🚀 Cấu hình & Triển khai

### 1. Yêu cầu môi trường
* PostgreSQL 15+ (Đã cài extension `pgvector`).
* Google Gemini API Key (Cần cho các tính năng AI).

### 2. Biến môi trường (.env)
```env
DATABASE_URL="postgresql://user:pass@localhost:5432/db?schema=public"
SECRET_API_KEY="AIzaSy..." # Google Gemini Key
ACCESS_TOKEN_SECRET="your-secret"
REFRESH_TOKEN_SECRET="your-refresh-secret"

# Email Config (IMAP/SMTP)
HR_ACCOUNTS='[{"email":"hr@company.com", "appPassword":"..."}]'
SMTP_USER="sender@company.com"
SMTP_PASS="password"