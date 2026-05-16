# 衛教資訊搜尋系統

期末專題原型：整合醫療院所公開衛教資訊，提供關鍵字搜尋、AI 症狀輔助搜尋、圖文內容瀏覽、Google 模擬登入與後台爬蟲更新。

## 功能

- Google 帳號模擬登入
- 關鍵字搜尋衛教文章
- AI 症狀輔助搜尋
- 文章完整內容頁
- 後台一鍵更新來源
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
- Environment Variable: `NODE_ENV=production`
