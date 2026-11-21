ECORP CHECK-IN QUA GOOGLE SHEET

Netlify phục vụ giao diện. Nhân viên đăng nhập bằng Google Identity Services.
Netlify chuyển ID token và yêu cầu điểm danh đến Web App Google Apps Script.
Apps Script xác thực token, tra email trong tab NHÂN VIÊN, lưu ảnh vào Drive
và ghi điểm danh vào tab CHECKIN.

Chuẩn bị trước khi triển khai

1. Dùng Google OAuth Client ID loại Web application. Trong Authorized JavaScript
   origins của OAuth client, xác nhận đã có cả https://ec-checkin.netlify.app
   và https://checkin.ecorp.edu.vn. Thêm origin riêng nếu thử trên deploy preview.
2. Trong Netlify, giữ GOOGLE_CLIENT_ID hiện có và xác nhận biến này có hiệu
   lực cho Functions trong Production. Thêm APPS_SCRIPT_URL trong cùng scope
   và context, dùng URL Web App đã cung cấp, kết thúc bằng /exec.
3. Xác nhận deployment /exec đang chạy mã Apps Script có doPost, hỗ trợ
   getCurrentUser và submitCheckin. Web App cần chạy dưới danh tính người triển
   khai và chấp nhận request từ Netlify mà không yêu cầu phiên Google trong
   trình duyệt. API của Apps Script kiểm tra Google ID token trong mỗi request.
4. CONFIG.NETLIFY_CONFIG_URL trong Apps Script phải trỏ đến endpoint
   /.netlify/functions/checkin?config=1 cung cấp cùng GOOGLE_CLIENT_ID.
   Nếu đổi Client ID thì chạy clearGoogleClientIdCache() trong Apps Script.
5. Xác nhận tab CHECKIN dùng cột I cho Đi khảo sát và J cho CheckinId.
   Quyền điểm danh dựa vào email trong cột E của tab NHÂN VIÊN. Nếu vừa sửa
   danh sách, dùng clearEmployeeCache(email) hoặc clearAllEmployeeCache()
   trong Apps Script để áp dụng thay đổi ngay.
6. Sau khi deploy, đăng nhập bằng email nhân viên, chụp ảnh và điểm danh.
   Xác nhận CHECKIN có một dòng mới với ảnh Drive, GPS, cảm xúc và cột Đi khảo
   sát đúng. Thử email ngoài danh sách để kiểm tra quyền truy cập.

Chuyển đổi và khôi phục

Trước khi chuyển production, kiểm tra các bản ghi Supabase còn chờ đồng bộ
đã vào CHECKIN. Bản này bỏ lịch chạy mỗi 5 phút và mặc định tắt các hàm đồng
bộ cũ. ENABLE_SUPABASE_SYNC=true chỉ bật lại endpoint đồng bộ, không tự
khôi phục lịch.

Để quay lại Supabase, có thể publish lại bản Netlify trước thay đổi này nếu
cấu hình Supabase cũ vẫn còn. Các lượt phát sinh trong thời gian dùng Apps
Script nằm trong CHECKIN và ảnh nằm trong Drive.
