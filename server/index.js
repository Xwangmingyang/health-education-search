import cors from "cors";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import * as cheerio from "cheerio";
import { PDFParse } from "pdf-parse";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const dbPath = path.join(rootDir, "data", "db.json");
const port = Number(process.env.PORT || 5173);
const sessions = new Map();
const oauthStates = new Map();
const isProduction = process.env.NODE_ENV === "production";

const knownArticleTitles = {
  "https://www.hc.mmh.org.tw/know_health_view.php?docid=834": "高血壓(Hypertension)",
  "https://www.mmh.org.tw/know_health_view.php?docid=895": "高血壓病患健康出遊去",
  "https://www.mmh.org.tw/child/know_health_view.php?docid=154": "年輕化的第 2 型糖尿病",
  "https://www.mmh.org.tw/child/know_health_view.php?docid=50": "兒童體循環高血壓",
  "https://www.mmh.org.tw/know_health_view.php?docid=1404": "流感與流感疫苗簡介",
  "https://www.mmh.org.tw/know_health_view.php?docid=900": "留學體檢與疫苗注意事項",
  "https://health.ntuh.gov.tw/health/new/6487.html": "淺談高血壓藥物",
  "https://health.ntuh.gov.tw/health/new/6260.html": "預防腦中風",
  "https://health.ntuh.gov.tw/health/NTUH_e_Net/NTUH_e_Net_no166/%E7%B3%96%E5%B0%BF%E7%97%85%E4%B9%8B%E6%96%B0%E5%88%86%E9%A1%9E.pdf": "糖尿病之新分類",
  "https://health.ntuh.gov.tw/health/NTUH_e_Net/NTUH_e_Net_no170/%E7%B3%96%E5%B0%BF%E7%97%85%E8%97%A5%E7%89%A9%E4%BB%8B%E7%B4%B9.pdf": "糖尿病藥物介紹",
  "https://www.kmuh.org.tw/Web/KMUHDept/Portals/sdm/0100-0160-4%20%2C.pdf": "第二型糖尿病用藥醫病共享決策",
  "https://www.femh.org.tw/magazine/viewmag?ID=10883": "年長者不容忽視的三高危害",
};

const fallbackImages = {
  chronic:
    "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&w=900&q=80",
  surgery:
    "https://images.unsplash.com/photo-1584515933487-779824d29309?auto=format&fit=crop&w=900&q=80",
  vaccine:
    "https://images.unsplash.com/photo-1612277795421-9bc7706a4a34?auto=format&fit=crop&w=900&q=80",
  heart:
    "https://images.unsplash.com/photo-1628348068343-c6a848d2b6dd?auto=format&fit=crop&w=900&q=80",
  diabetes:
    "https://images.unsplash.com/photo-1581595220892-b0739db3ba8c?auto=format&fit=crop&w=900&q=80",
  clinic:
    "https://images.unsplash.com/photo-1505751172876-fa1923c5c528?auto=format&fit=crop&w=900&q=80",
};

const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json({ limit: "1mb" }));

async function readDb() {
  const raw = await fs.readFile(dbPath, "utf8");
  return JSON.parse(raw);
}

async function writeDb(db) {
  await fs.writeFile(dbPath, `${JSON.stringify(db, null, 2)}\n`, "utf8");
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatarUrl: user.avatarUrl,
    loginProvider: user.loginProvider || "google",
  };
}

function normalizeText(value = "") {
  return value.replace(/\s+/g, " ").trim();
}

function getBaseUrl(req) {
  return process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
}

function getGoogleCallbackUrl(req) {
  return process.env.GOOGLE_CALLBACK_URL || `${getBaseUrl(req)}/api/auth/google/callback`;
}

function getAdminEmails() {
  if (!process.env.ADMIN_EMAILS && isProduction) return [];
  return String(process.env.ADMIN_EMAILS || "health.admin@gmail.com")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function roleForEmail(email) {
  return getAdminEmails().includes(String(email).toLowerCase()) ? "admin" : "user";
}

function createSession(user) {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, publicUser(user));
  return token;
}

function getCookie(req, name) {
  return String(req.headers.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function sessionCookie(token) {
  const secure = isProduction ? "; Secure" : "";
  return `health_search_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 7}${secure}`;
}

function expiredSessionCookie() {
  const secure = isProduction ? "; Secure" : "";
  return `health_search_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

function googleOAuthConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

async function upsertGoogleUser({ email, name, avatarUrl }) {
  const db = await readDb();
  const normalizedEmail = normalizeText(email).toLowerCase();
  let user = db.users.find((item) => item.email.toLowerCase() === normalizedEmail);
  const role = roleForEmail(normalizedEmail);

  if (!user) {
    user = {
      id: `u-${crypto.randomBytes(6).toString("hex")}`,
      name: name || normalizedEmail.split("@")[0],
      email: normalizedEmail,
      role,
      loginProvider: "google",
      avatarUrl:
        avatarUrl ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(name || normalizedEmail)}&background=0b7f79&color=fff`,
    };
    db.users.push(user);
  } else {
    user.name = name || user.name;
    user.role = role;
    user.loginProvider = "google";
    user.avatarUrl = avatarUrl || user.avatarUrl;
  }

  await writeDb(db);
  return user;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanTitleCandidate(rawTitle, clinicName) {
  const raw = normalizeText(rawTitle);
  if (!raw) return "";

  const badPatterns = [
    /回首頁/i,
    /LOGO/i,
    /^衛教(專區|單張|資訊)?$/,
    /^掛號服務$/,
    /^科室介紹$/,
    /Far Eastern Memorial Hospital/i,
  ];
  const candidates = raw
    .split(/[|｜]/)
    .flatMap((part) => part.split(/\s+-\s+/))
    .map((part) => normalizeText(part))
    .filter((part) => part.length >= 3)
    .filter((part) => !badPatterns.some((pattern) => pattern.test(part)))
    .filter((part) => part !== clinicName && !part.includes("附設醫院"));

  if (candidates.length > 0) {
    return candidates.sort((a, b) => b.length - a.length)[0];
  }

  return badPatterns.some((pattern) => pattern.test(raw)) ? "" : raw;
}

function pickTitle($, clinicName, url = "") {
  if (knownArticleTitles[url]) return knownArticleTitles[url];

  const pageText = normalizeText($("body").text());

  if (url.includes("chimei.org.tw")) {
    const titleMatch = pageText.match(/衛教單張編號[:：]?\s*[A-Z0-9-]+\s+(.+?)\s+By\s+/i);
    if (titleMatch?.[1]) return normalizeText(titleMatch[1]);
  }

  if (url.includes("femh.org.tw")) {
    const headings = $("h1, h2, h3")
      .map((_, element) => cleanTitleCandidate($(element).text(), clinicName))
      .get()
      .filter((item) => item && !/亞東院訊|我要發問|最新院訊|歷年院訊/.test(item));
    const topicHeading = headings.find((item) => /三高|高血糖|高血脂|糖尿病|高血壓|血壓|衛教|疫苗|照護/.test(item));
    if (topicHeading || headings[0]) return topicHeading || headings[0];
  }

  if (url.includes("mercy.org.tw")) {
    const titleMatch = pageText.match(/標\s*題\s+(.+?)\s+張貼日期/);
    if (titleMatch?.[1]) return normalizeText(titleMatch[1]);
  }

  const candidates = [
    $('meta[property="og:title"]').attr("content"),
    $("h1").first().text(),
    $("h2").first().text(),
    $("h3").first().text(),
    $("title").first().text(),
  ];

  return candidates.map((candidate) => cleanTitleCandidate(candidate, clinicName)).find(Boolean) || clinicName;
}

function classifyArticle(title, text, url) {
  const buckets = [
    { category: "慢性病", terms: ["代謝症候群", "糖尿病", "高血壓", "高血脂", "三高", "痛風", "失眠"] },
    { category: "外科", terms: ["外傷", "換藥", "傷口", "縫合", "甲溝炎", "清瘡"] },
    { category: "疫苗", terms: ["疫苗", "流感", "肺炎鏈球菌", "B型肝炎", "帶狀皰疹"] },
    { category: "急性疾病", terms: ["感冒", "發燒", "腸胃炎", "泌尿道感染"] },
    { category: "皮膚病", terms: ["皮膚", "青春痘", "灰指甲", "除斑", "除痣"] },
  ];

  if (url.includes("projects")) return "綜合診療";

  const scored = buckets
    .map((bucket) => ({
      category: bucket.category,
      score: bucket.terms.reduce((total, term) => {
        const titleHit = title.includes(term) ? 5 : 0;
        const textHit = text.includes(term) ? 1 : 0;
        return total + titleHit + textHit;
      }, 0),
    }))
    .sort((a, b) => b.score - a.score);

  return scored[0]?.score > 0 ? scored[0].category : "一般衛教";
}

function keywordize(text) {
  const candidates = [
    "代謝症候群",
    "糖尿病",
    "高血壓",
    "高血脂",
    "三高",
    "失眠",
    "焦慮",
    "疫苗",
    "帶狀皰疹",
    "流感",
    "外傷",
    "換藥",
    "傷口",
    "甲溝炎",
    "腸胃炎",
    "感冒",
    "發燒",
    "糞便篩檢",
    "痛風",
    "減重",
    "帶狀皰疹",
  ];
  return [...new Set(candidates.filter((term) => text.includes(term)))];
}

function createSummary(text) {
  const cleaned = normalizeText(text);
  if (cleaned.length <= 122) return cleaned;
  return `${cleaned.slice(0, 120)}...`;
}

function cleanupArticleText(text, title) {
  let cleaned = normalizeText(text)
    .replace(/<[^>]+>/g, " ")
    .replace(/Your browser \(Internet Explorer 7 or lower\)[^.]+features(?: of this and other websites)?\. Learn how to update your browser\.?\s*X?/gi, " ")
    .replace(/您的瀏覽器不支援JavaScript功能[^。]*。/g, " ")
    .replace(/本網站所有互動功能皆使用javascript[^！]*！/gi, " ")
    .replace(/若「[^」]+」功能無法正常使用時[^！]*！/g, " ")
    .replace(/跳到主要內容區塊|Previous Next|A- A A\+|A- A\+|Qrcode|列印|Image/g, " ")
    .replace(/首頁\/|首頁 >>|捷徑位置:/g, " ")
    .replace(/繁體中文\s*Việt NamBahasa IndonesiaไทยPilipino繁體中文简体中文English日本語한국어DeutschFrançaisEspañolPortuguêsItalianoРусскийالعربيةLatine/g, " ")
    .replace(/回首頁\s*\|\s*網站導覽\s*\|\s*網路掛號/g, " ")
    .replace(/台中市\s*大雅區/g, " ")
    .replace(/:::/g, " ")
    .replace(/所有衛教資訊列表\s*標題\s*點閱次數/g, " ")
    .replace(/\d+次/g, " ")
    .replace(/(?:照片|圖片|圖示|如圖|圖一|圖二|圖三|圖四|圖五)[一二三四五六七八九十\d：:、，, ]*/g, " ")
    .replace(/(?:見下圖|如下圖|上圖|下圖|左圖|右圖)[。；，,]*/g, " ");

  const titleIndex = cleaned.indexOf(title);
  if (titleIndex >= 0 && titleIndex < 1400) {
    cleaned = cleaned.slice(titleIndex + title.length);
  }

  cleaned = cleaned
    .replace(/^首頁\s+亞東訊息\s+亞東院訊\s+亞東院訊\s+最新院訊\s+歷年院訊\s+亞東院訊\s+第\d+期\s+\d+年\d+月\s+我要發問\s*/g, " ")
    .replace(/^首頁\s+內科部門\s+[^ ]+\s+/g, " ")
    .replace(/^首頁\s+Menu\s+▾[\s\S]{0,900}?高血壓\s+/g, " ")
    .replace(/^內分泌新陳代謝科\s+首頁\s+內科部門\s+內分泌新陳代謝科\s+/g, " ")
    .replace(/^心臟血管內科\s+首頁\s+內科部門\s+心臟血管內科\s+/g, " ")
    .replace(/^衛教單張編號[:：]?\s*[A-Z0-9-]+\s*/i, " ")
    .replace(/^By\s+[^|]+?\|\s+[A-Za-z]+,\s+\d{4}\s*/i, " ");

  if (title.includes("冠狀動脈疾病衛教手冊")) {
    const realStart = cleaned.lastIndexOf("2.認識自己的心臟");
    if (realStart > 0) cleaned = cleaned.slice(realStart);
  }

  cleaned = normalizeText(cleaned)
    .replace(new RegExp(`^${escapeRegExp(title)}\\s*`), "")
    .replace(new RegExp(`^[\\s\\S]{0,800}${escapeRegExp(title)}\\s*`), "")
    .replace(/^By\s+[^|]+?\|\s+[A-Za-z]+,\s+\d{4}\s*/i, "")
    .replace(/^張貼日期\s+\S+\s+張貼單位\s+\S+\s+內\s*容\s*/g, "")
    .replace(/^【回本期目錄】\s*/g, "")
    .replace(/^文章語音朗讀連結\s*/g, "")
    .replace(/^\.文章語音朗讀連結\s*/g, "")
    .replace(/[.。]?文章語音朗讀連結\s*/g, "");

  const cutMarkers = [
    "回上頁",
    "回上一頁",
    "回瀏覽頁",
    "開啟網站導覽",
    "隱私權聲明",
    "若您的瀏覽器不支援 javascript語法",
    "開關 首頁",
    "Facebook Instagram",
    "SHARE TAGS",
    "更新日期：",
    "首頁 訊息專區",
    "製作單位：",
    "若有任何疑問",
    "電話：",
    "院址：",
    "意見信箱",
    "～諮詢電話～",
  ];

  for (const marker of cutMarkers) {
    const index = cleaned.indexOf(marker);
    if (index > 160) cleaned = cleaned.slice(0, index);
  }

  return normalizeText(cleaned)
    .split(/(?=衛教資訊 >|首頁 科部介紹|首頁 科室介紹)/)
    .pop()
    .replace(/^衛教資訊\s*>\s*衛教單張\s*>\s*衛教影片\s*>\s*衛教海報\s*>\s*各科室衛教諮詢窗口\s*>\s*/g, "")
    .trim();
}

function imageForCategory(category, text = "") {
  if (category === "疫苗") return fallbackImages.vaccine;
  if (category === "外科") return fallbackImages.surgery;
  if (category === "綜合診療") return fallbackImages.clinic;
  const leadText = text.slice(0, 140);
  if (
    leadText.includes("高血壓") ||
    leadText.includes("心臟") ||
    leadText.includes("冠狀動脈") ||
    leadText.includes("心血管")
  ) {
    return fallbackImages.heart;
  }
  if (leadText.includes("糖尿病") || leadText.includes("血糖")) return fallbackImages.diabetes;
  if (text.includes("糖尿病") || text.includes("血糖")) return fallbackImages.diabetes;
  if (category === "慢性病") return fallbackImages.chronic;
  return fallbackImages.clinic;
}

function isLowValueArticle({ title, content, url }) {
  const compact = normalizeText(`${title} ${content}`);
  const lowValuePatterns = [
    /Service Unavailable|HTTP Error 503/i,
    /主題名稱\s+下載\s+QRCODE/,
    /衛教專區\s*>\s*糖尿病疾病/,
    /衛教知識\s+認識糖尿病：守護您的健康\s+高低血糖的預防和處理/,
    /顯示類別：全部衛教資訊/,
    /內科心臟內科腎臟內科新陳代謝科血液腫瘤科/,
  ];

  return (
    compact.length < 90 ||
    title === "衛生福利部雙和醫院" ||
    url.includes("Health.aspx?deptCode=") ||
    lowValuePatterns.some((pattern) => pattern.test(compact))
  );
}

function absoluteUrl(value, baseUrl) {
  if (!value) return "";
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return "";
  }
}

function isZhangrenListPage(url) {
  return /zhangrenclinic\.com\.tw\/contents-\d+\.html$/i.test(url);
}

function isZhangrenArticlePage(url) {
  return /zhangrenclinic\.com\.tw\/content-\d+\.html$/i.test(url);
}

function isStmEducationListPage(url) {
  return /stm\.org\.tw\/diabetes\/education(?:\.aspx)?\?Typeid=/i.test(url);
}

function isPdfUrl(url) {
  return /\.pdf(?:$|\?)/i.test(url);
}

function discoverArticleTargets({ html, url }) {
  const $ = cheerio.load(html);

  if (isStmEducationListPage(url)) {
    const targets = new Map();
    $('a[href$=".pdf"], a[href*=".pdf?"]').each((_, link) => {
      const href = absoluteUrl($(link).attr("href"), url);
      const title = normalizeText($(link).text());
      if (href && title && !targets.has(href)) targets.set(href, { url: href, title });
    });
    return [...targets.values()];
  }

  if (!isZhangrenListPage(url)) return [{ url }];

  const targets = new Map();

  $(".news_lists").each((_, card) => {
    const href = $(card)
      .find('a[href*="content-"]')
      .map((__, link) => absoluteUrl($(link).attr("href"), url))
      .get()
      .find((item) => isZhangrenArticlePage(item));
    if (!href) return;

    const imageUrl = absoluteUrl($(card).find("img").first().attr("src"), url);
    targets.set(href, { url: href, imageUrl });
  });

  $('a[href*="content-"]').each((_, link) => {
    const href = absoluteUrl($(link).attr("href"), url);
    if (isZhangrenArticlePage(href) && !targets.has(href)) {
      targets.set(href, { url: href });
    }
  });

  return [...targets.values()];
}

async function extractPdfArticle({ url, clinicName, title: targetTitle = "" }) {
  const parser = new PDFParse({ url });
  try {
    const result = await parser.getText();
    const rawText = normalizeText(result.text || "");
    const title =
      knownArticleTitles[url] ||
      cleanTitleCandidate(targetTitle, clinicName) ||
      cleanTitleCandidate(rawText.split(/\n/).find((line) => normalizeText(line).length >= 3) || "", clinicName) ||
      clinicName;
    const cleaned = cleanupArticleText(rawText, title);
    if (isLowValueArticle({ title, content: cleaned, url })) {
      throw new Error("略過非完整衛教文章或列表頁。");
    }
    const category = classifyArticle(title, cleaned, url);
    const keywords = keywordize(`${title} ${cleaned.slice(0, 1200)}`);
    const sourceHash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 10);

    return {
      id: `crawl-${sourceHash}`,
      title,
      clinicName,
      category,
      summary: createSummary(cleaned),
      fullContent: cleaned,
      keywords,
      imageUrl: imageForCategory(category, `${title} ${cleaned}`),
      sourceUrl: url,
      sourceType: "crawled",
      publishedAt: new Date().toISOString().slice(0, 10),
      crawledAt: new Date().toISOString(),
      excerpt: "由公開 PDF 衛教單擷取文字後建立索引，保留原始來源方便回到院所網站查證。",
    };
  } finally {
    await parser.destroy();
  }
}

function pickPageImage($, url, category, articleText = "", preferredImageUrl = "") {
  const preferredImage = absoluteUrl(preferredImageUrl, url);
  if (preferredImage && !/logo|TOP_|call|phone|facebook|line|icon/i.test(preferredImage)) {
    return preferredImage;
  }

  const topicImage = imageForCategory(category, articleText);
  if (category !== "一般衛教") return topicImage;

  const badImagePattern =
    /logo|qrcode|qrserver|top[_-]?up|call|phone|tel|carousel|alldept|回首頁|facebook|instagram|icon|sprite|banner|NTUH_HRC|6456_1|57320002-01/i;
  const candidates = [
    ...$('meta[property="og:image"], meta[name="twitter:image"]')
      .map((_, element) => $(element).attr("content"))
      .get(),
    ...$("main img, article img, .content img, .main img, body img")
      .map((_, element) => $(element).attr("src"))
      .get(),
  ]
    .map((item) => absoluteUrl(item, url))
    .filter(Boolean)
    .filter((item) => !badImagePattern.test(item));

  const image = candidates.find((item) => /\.(jpg|jpeg|png|webp)(\?|$)/i.test(item));
  return image || topicImage;
}

function authRequired(req, res, next) {
  const bearerToken = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const token = bearerToken || getCookie(req, "health_search_session");
  const user = token ? sessions.get(token) : null;
  if (!user) {
    return res.status(401).json({ message: "請先使用 Google 帳號登入。" });
  }
  req.user = user;
  next();
}

function adminRequired(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "需要管理員權限。" });
  }
  next();
}

async function fetchHtml(url, useBrowser) {
  if (!useBrowser) {
    const response = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36 HealthEducationSearchBot/0.1",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1200);
    return await page.content();
  } finally {
    await browser.close();
  }
}

function extractArticle({ html, url, clinicName, imageUrl = "" }) {
  const $ = cheerio.load(html);
  const title = pickTitle($, clinicName, url);
  $("script, style, header, nav, footer, iframe, noscript, svg").remove();
  const bodyText = normalizeText(
    isZhangrenArticlePage(url) && $(".newsdetail").length
      ? $(".newsdetail").text()
      : $("main").text() || $("body").text(),
  );
  const content = bodyText
    .replace(/首 頁|診 療 項 目|醫 療 團 隊|衛 教 文 章|聯 絡 我 們/g, " ")
    .replace(/瀏覽人數：?\d*/g, " ");
  const cleaned = cleanupArticleText(content, title);
  if (isLowValueArticle({ title, content: cleaned, url })) {
    throw new Error("略過非完整衛教文章或列表頁。");
  }
  const category = classifyArticle(title, cleaned, url);
  const keywords = keywordize(`${title} ${cleaned.slice(0, 1200)}`);
  const sourceHash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 10);

  return {
    id: `crawl-${sourceHash}`,
    title,
    clinicName,
    category,
    summary: createSummary(cleaned),
    fullContent: cleaned,
    keywords,
    imageUrl: pickPageImage($, url, category, `${title} ${cleaned}`, imageUrl),
    sourceUrl: url,
    sourceType: "crawled",
    publishedAt: new Date().toISOString().slice(0, 10),
    crawledAt: new Date().toISOString(),
    excerpt: "已抓取公開頁面文字與相關圖片並產生摘要。專題展示以摘要、圖片與來源連結呈現，完整內容請回原網站閱讀。",
  };
}

function scoreArticle(article, query) {
  if (!query) return 1;
  const q = query.toLowerCase();
  const title = article.title.toLowerCase();
  const clinicName = article.clinicName.toLowerCase();
  const summary = article.summary.toLowerCase();
  const fullContent = String(article.fullContent || "").toLowerCase();
  const keywords = article.keywords.join(" ").toLowerCase();
  let score = 0;
  if (title.includes(q)) score += 5;
  if (clinicName.includes(q)) score += 4;
  if (keywords.includes(q)) score += 3;
  if (summary.includes(q)) score += 2;
  if (fullContent.includes(q)) score += 1;
  return score;
}

const symptomHints = [
  { terms: ["頭暈", "想睡", "口渴", "頻尿", "體重減輕", "血糖"], keywords: ["糖尿病", "血糖"] },
  { terms: ["血壓", "頭痛", "胸悶", "心悸", "腎臟"], keywords: ["高血壓", "心血管"] },
  { terms: ["發燒", "咳嗽", "喉嚨痛", "流鼻水", "肌肉痠痛"], keywords: ["流感", "疫苗", "感冒"] },
  { terms: ["傷口", "流血", "換藥", "縫合", "化膿"], keywords: ["傷口", "換藥", "外傷"] },
  { terms: ["水泡", "神經痛", "皮蛇", "帶狀皰疹"], keywords: ["帶狀皰疹", "疫苗"] },
  { terms: ["失眠", "焦慮", "睡不著"], keywords: ["失眠", "焦慮"] },
];

function inferSearchTerms(input) {
  const matched = symptomHints
    .filter((hint) => hint.terms.some((term) => input.includes(term)))
    .flatMap((hint) => hint.keywords);
  const direct = keywordize(input);
  return Array.from(new Set([...matched, ...direct])).slice(0, 6);
}

function aiScoreArticle(article, input, inferredTerms) {
  const haystack = `${article.title} ${article.clinicName} ${article.category} ${article.keywords.join(" ")} ${article.summary} ${article.fullContent || ""}`;
  let score = 0;

  for (const term of inferredTerms) {
    if (article.title.includes(term)) score += 6;
    if (article.keywords.includes(term)) score += 5;
    if (article.summary.includes(term)) score += 3;
    if (String(article.fullContent || "").includes(term)) score += 1;
  }

  for (const token of input.split(/[，,。；;\s]+/).filter((item) => item.length >= 2)) {
    if (haystack.includes(token)) score += 2;
  }

  return score;
}

app.get("/api/auth/google", (req, res) => {
  if (!googleOAuthConfigured()) {
    return res.redirect("/?auth=missing-google-config");
  }

  const state = crypto.randomBytes(18).toString("hex");
  oauthStates.set(state, Date.now() + 10 * 60 * 1000);

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: getGoogleCallbackUrl(req),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

app.get("/api/auth/google/callback", async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect(`/?auth=${encodeURIComponent(String(error))}`);

  const stateExpiresAt = oauthStates.get(String(state || ""));
  oauthStates.delete(String(state || ""));
  if (!code || !stateExpiresAt || stateExpiresAt < Date.now()) {
    return res.redirect("/?auth=invalid-state");
  }

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code: String(code),
        grant_type: "authorization_code",
        redirect_uri: getGoogleCallbackUrl(req),
      }),
    });

    if (!tokenResponse.ok) throw new Error("Google token exchange failed");
    const tokenData = await tokenResponse.json();

    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!profileResponse.ok) throw new Error("Google profile request failed");
    const profile = await profileResponse.json();

    if (!profile.email || profile.email_verified === false) {
      throw new Error("Google email is not verified");
    }

    const user = await upsertGoogleUser({
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.picture,
    });
    const token = createSession(user);
    res.setHeader("Set-Cookie", sessionCookie(token));
    res.redirect("/");
  } catch (err) {
    console.error(err);
    res.redirect("/?auth=google-login-failed");
  }
});

app.post("/api/google-login", async (req, res) => {
  if (isProduction) {
    return res.status(410).json({ message: "正式環境請使用 Google OAuth 登入。" });
  }

  const email = normalizeText(String(req.body.email || "")).toLowerCase();
  const name = normalizeText(String(req.body.name || ""));
  const avatarUrl = normalizeText(String(req.body.avatarUrl || ""));

  if (!email || !email.includes("@")) {
    return res.status(400).json({ message: "請輸入有效的 Google 電子郵件。" });
  }

  const user = await upsertGoogleUser({ email, name, avatarUrl });
  const token = createSession(user);
  res.setHeader("Set-Cookie", sessionCookie(token));
  res.json({ token, user: publicUser(user) });
});

app.get("/api/me", authRequired, (req, res) => {
  res.json({ user: req.user });
});

app.post("/api/logout", authRequired, (req, res) => {
  const bearerToken = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const token = bearerToken || getCookie(req, "health_search_session");
  if (token) sessions.delete(token);
  res.setHeader("Set-Cookie", expiredSessionCookie());
  res.json({ ok: true });
});

app.get("/api/articles", authRequired, async (req, res) => {
  const query = normalizeText(String(req.query.query || ""));
  const category = String(req.query.category || "全部");
  const db = await readDb();
  const articles = db.articles
    .map((article) => ({
      ...article,
      imageUrl: article.imageUrl || imageForCategory(article.category, `${article.title} ${article.summary} ${article.fullContent || ""}`),
      score: scoreArticle(article, query),
    }))
    .filter((article) => article.score > 0)
    .filter((article) => category === "全部" || article.category === category)
    .sort((a, b) => b.score - a.score || b.crawledAt.localeCompare(a.crawledAt));

  res.json({
    articles,
    categories: ["全部", ...Array.from(new Set(db.articles.map((article) => article.category)))],
  });
});

app.post("/api/ai-search", authRequired, async (req, res) => {
  const input = normalizeText(String(req.body.query || ""));
  if (input.length < 2) {
    return res.status(400).json({ message: "請輸入至少兩個字的症狀或描述。" });
  }

  const db = await readDb();
  const inferredTerms = inferSearchTerms(input);
  const fallbackTerms = inferredTerms.length > 0 ? inferredTerms : [input];
  const matches = db.articles
    .map((article) => ({
      ...article,
      score: aiScoreArticle(article, input, fallbackTerms),
    }))
    .filter((article) => article.score > 0)
    .sort((a, b) => b.score - a.score || b.crawledAt.localeCompare(a.crawledAt))
    .slice(0, 5);

  const focus = fallbackTerms.slice(0, 4).join("、");
  const summary =
    matches.length > 0
      ? `依照你輸入的「${input}」，系統推測可先查看 ${focus} 相關衛教資料。以下結果來自已索引的醫療院所公開衛教內容，適合用來做初步閱讀與就醫前準備。`
      : `目前索引中沒有直接符合「${input}」的資料，可以改用更明確的症狀或疾病名稱重新搜尋。`;

  res.json({
    query: input,
    inferredTerms: fallbackTerms,
    summary,
    notice: "AI 輔助搜尋只做衛教資訊整理，不能取代醫師診斷；若症狀急迫或持續惡化，請儘快就醫。",
    articles: matches.map((article) => ({
      id: article.id,
      title: article.title,
      clinicName: article.clinicName,
      category: article.category,
      summary: article.summary,
      imageUrl: article.imageUrl,
      sourceUrl: article.sourceUrl,
      crawledAt: article.crawledAt,
      keywords: article.keywords,
    })),
  });
});

app.get("/api/admin/sources", authRequired, adminRequired, async (_req, res) => {
  const db = await readDb();
  res.json({ sources: db.crawlerSources, crawlRuns: db.crawlRuns.slice(-8).reverse() });
});

app.post("/api/admin/crawl", authRequired, adminRequired, async (req, res) => {
  const { sourceId = "src-zhangren", mode = "browser" } = req.body;
  const db = await readDb();
  const source = db.crawlerSources.find((item) => item.id === sourceId);
  if (!source) return res.status(404).json({ message: "找不到爬蟲來源。" });

  const run = {
    id: `run-${Date.now()}`,
    sourceId,
    mode,
    startedAt: new Date().toISOString(),
    status: "running",
    found: 0,
    errors: [],
  };

  const nextArticles = [...db.articles];
  const crawlTargets = [];
  for (const url of source.urls) {
    try {
      const html = await fetchHtml(url, mode === "browser");
      const discoveredTargets = discoverArticleTargets({ html, url });
      if (discoveredTargets.length > 1 || discoveredTargets[0]?.url !== url) {
        crawlTargets.push(...discoveredTargets);
        continue;
      }
      crawlTargets.push({ url, html });
    } catch (error) {
      run.errors.push(`${url}: ${error.message}`);
    }
  }

  const uniqueTargets = Array.from(
    crawlTargets
      .reduce((targets, target) => {
        if (!targets.has(target.url)) targets.set(target.url, target);
        return targets;
      }, new Map())
      .values(),
  );

  for (const target of uniqueTargets) {
    try {
      const article = isPdfUrl(target.url)
        ? await extractPdfArticle({
            url: target.url,
            clinicName: source.clinicName,
            title: target.title,
          })
        : extractArticle({
            html: target.html || (await fetchHtml(target.url, mode === "browser")),
            url: target.url,
            clinicName: source.clinicName,
            imageUrl: target.imageUrl,
          });
      const existingIndex = nextArticles.findIndex((item) => item.sourceUrl === article.sourceUrl);
      if (existingIndex >= 0) {
        nextArticles[existingIndex] = { ...nextArticles[existingIndex], ...article };
      } else {
        nextArticles.push(article);
      }
      run.found += 1;
    } catch (error) {
      if (!String(error.message || "").includes("略過非完整衛教文章或列表頁")) {
        run.errors.push(`${target.url}: ${error.message}`);
      }
    }
  }

  run.status = run.found === 0 ? "failed" : "completed";
  run.finishedAt = new Date().toISOString();
  db.articles = nextArticles;
  db.crawlRuns.push(run);
  await writeDb(db);
  res.json({ run, articles: nextArticles.filter((article) => article.sourceType === "crawled") });
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(rootDir, "dist")));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(rootDir, "dist", "index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
    root: rootDir,
  });
  app.use(vite.middlewares);
}

app.listen(port, () => {
  console.log(`Health education search system is running at http://localhost:${port}`);
});
