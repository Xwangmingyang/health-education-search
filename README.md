# 衛教資訊搜尋系統

期末專題原型：整合醫療院所公開衛教資訊，提供關鍵字搜尋、AI 症狀輔助搜尋、圖文內容瀏覽、正式 Google OAuth 登入與後台爬蟲更新。

## 功能

- Google OAuth 帳號登入
- 關鍵字搜尋衛教文章
- AI 症狀輔助搜尋
- 文章完整內容頁
- 後台一鍵更新來源
- 管理員信箱獨立設定
- 醫療院所來源管理與爬取紀錄

## 開發啟動

```powershell
npm install
npm run dev
```

開啟：

```txt
http://localhost:5173
```

## 生產部署

```powershell
npm install
npm run build
npm start
```

Render 可使用：

- Build Command: `npm install && npm run build`
- Start Command: `npm start`
- Environment Variables:
  - `NODE_ENV=production`
  - `APP_BASE_URL=https://health-education-search.onrender.com`
  - `GOOGLE_CLIENT_ID=你的 Google OAuth Client ID`
  - `GOOGLE_CLIENT_SECRET=你的 Google OAuth Client Secret`
  - `GOOGLE_CALLBACK_URL=https://health-education-search.onrender.com/api/auth/google/callback`
  - `ADMIN_EMAILS=管理員 Gmail`，多個信箱可用逗號分隔

Google Cloud Console 的 OAuth Client 需要加入：

- Authorized JavaScript origins: `https://health-education-search.onrender.com`
- Authorized redirect URIs: `https://health-education-search.onrender.com/api/auth/google/callback`
