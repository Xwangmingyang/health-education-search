# 衛教資訊搜尋系統部署說明

## Render 設定

此專案是 React + Express 的 Node 全端系統。

Render Web Service 設定：

- Runtime: Node
- Build Command: `npm install && npm run build`
- Start Command: `npm start`
- Environment Variable: `NODE_ENV=production`

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
- 登入目前為 Google 帳號模擬登入，正式上線可替換為 Google OAuth。
