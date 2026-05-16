# 衛教資訊搜尋系統部署說明

## Render 設定

此專案是 React + Express 的 Node 全端系統。

Render Web Service 設定：

- Runtime: Node
- Build Command: `npm install && npm run build`
- Start Command: `npm start`
- Environment Variables:
  - `NODE_ENV=production`
  - `APP_BASE_URL=https://health-education-search.onrender.com`
  - `GOOGLE_CLIENT_ID=你的 Google OAuth Client ID`
  - `GOOGLE_CLIENT_SECRET=你的 Google OAuth Client Secret`
  - `GOOGLE_CALLBACK_URL=https://health-education-search.onrender.com/api/auth/google/callback`
  - `ADMIN_EMAILS=管理員 Gmail`，多個管理員可用逗號分隔

## Google OAuth 設定

到 Google Cloud Console 建立 OAuth 2.0 Client ID：

- Application type: Web application
- Authorized JavaScript origins: `https://health-education-search.onrender.com`
- Authorized redirect URIs: `https://health-education-search.onrender.com/api/auth/google/callback`

建立後把 Client ID 與 Client Secret 貼到 Render 的 Environment Variables。
`ADMIN_EMAILS` 只放可以進後台的 Google 信箱，一般使用者登入後只能使用搜尋功能。

## 本機測試

```powershell
npm install
npm run build
npm start
```

開啟：

```txt
http://localhost:5173
```

## 注意事項

- `data/db.json` 目前作為展示用資料庫。
- 免費雲端服務重新部署後，後台新增或更新的資料可能回到 GitHub 版本。
- 正式上線建議改用 PostgreSQL、Supabase 或其他資料庫。
- 登入已改為 Google OAuth。若 Render 未設定 Google 相關環境變數，登入頁會提示尚未設定。
