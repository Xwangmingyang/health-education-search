import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowLeft,
  Brain,
  Bot,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Filter,
  Image,
  LogOut,
  Mail,
  Search,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  X,
} from "lucide-react";
import "./styles.css";

const googleAccounts = [
  {
    label: "管理員 Google",
    email: "health.admin@gmail.com",
    name: "專題管理員",
    roleHint: "可使用搜尋與後台爬蟲",
    avatarUrl: "https://ui-avatars.com/api/?name=Admin&background=0b7f79&color=fff",
  },
  {
    label: "一般 Google",
    email: "student.demo@gmail.com",
    name: "一般使用者",
    roleHint: "可使用衛教搜尋",
    avatarUrl: "https://ui-avatars.com/api/?name=Student&background=31515a&color=fff",
  },
];

function api(path, options = {}) {
  const token = localStorage.getItem("health-search-token");
  return fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "系統暫時無法處理請求");
    return data;
  });
}

function Login({ onLogin }) {
  const [googleProfile, setGoogleProfile] = useState(googleAccounts[0]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function loginWithGoogle(profile) {
    setLoading(true);
    setError("");
    try {
      const data = await api("/api/google-login", {
        method: "POST",
        body: JSON.stringify(profile),
      });
      localStorage.setItem("health-search-token", data.token);
      onLogin(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    await loginWithGoogle(googleProfile);
  }

  return (
    <main className="login-shell">
      <section className="login-art">
        <div className="brand-mark">
          <Activity size={28} />
        </div>
        <h1>衛教資訊搜尋系統</h1>
        <p>
          整合醫療院所公開衛教資訊，提供關鍵字搜尋、圖文瀏覽與來源查證，協助使用者快速找到可信的健康知識。
        </p>
        <div className="feature-row">
          <span>
            <Search size={16} />
            關鍵字搜尋
          </span>
          <span>
            <Image size={16} />
            圖文衛教內容
          </span>
        </div>
        <div className="hero-dashboard">
          <div className="hero-metrics">
            <div>
              <strong>9+</strong>
              <span>公開來源</span>
            </div>
            <div>
              <strong>18+</strong>
              <span>衛教索引</span>
            </div>
            <div>
              <strong>5</strong>
              <span>主題分類</span>
            </div>
          </div>
          <div className="hero-flow">
            <span>公開頁面</span>
            <i />
            <span>爬蟲整理</span>
            <i />
            <span>搜尋閱讀</span>
          </div>
          <div className="hero-sources">
            {["彰仁診所", "中國附醫", "台大醫院", "馬偕醫院", "仁慈醫院", "聖馬爾定", "奇美醫院", "高醫", "亞東醫院"].map((source) => (
              <span key={source}>{source}</span>
            ))}
          </div>
        </div>
      </section>

      <form className="login-panel" onSubmit={submit}>
        <div className="panel-title">
          <span className="google-mark">G</span>
          <div>
            <h2>選擇登入帳號</h2>
            <small>Google 模擬登入</small>
          </div>
        </div>
        <p className="login-note">
          選擇專題展示帳號後即可進入系統，正式上線時可替換為 OAuth 驗證。
        </p>
        <div className="account-preview selected-account">
          <img src={googleProfile.avatarUrl} alt="" />
          <div>
            <strong>{googleProfile.name}</strong>
            <span>{googleProfile.email}</span>
          </div>
          <CheckCircle2 size={20} />
        </div>
        {error && <p className="form-error">{error}</p>}
        <button className="google-btn" disabled={loading}>
          <span className="google-mark">G</span>
          {loading ? "登入中..." : "以此帳號繼續"}
          <ChevronRight size={18} />
        </button>
        <div className="account-grid">
          {googleAccounts.map((account) => (
            <button
              type="button"
              className={googleProfile.email === account.email ? "selected" : ""}
              key={account.email}
              onClick={() => setGoogleProfile(account)}
              disabled={loading}
            >
              <img src={account.avatarUrl} alt="" />
              <span>
                <strong>{account.label}</strong>
                <small>{account.roleHint}</small>
              </span>
              {googleProfile.email === account.email && <CheckCircle2 size={18} />}
            </button>
          ))}
        </div>
      </form>
    </main>
  );
}

function DetailPage({ article, onBack, onKeyword }) {
  if (!article) {
    return (
      <section className="workspace">
        <button className="ghost-btn" onClick={onBack}>
          <ArrowLeft size={18} />
          返回搜尋
        </button>
        <div className="empty-state">目前沒有選取文章。</div>
      </section>
    );
  }

  const noisePatterns = [
    /照片|圖片|圖示|如圖|見下圖|如下圖|上圖|下圖|左圖|右圖/,
    /您的瀏覽器不支援|JavaScript|Qrcode|列印|回上頁|回瀏覽頁/,
    /衛教資訊\s*>|首頁\s*科部介紹|SHARE TAGS|更新日期：|製作單位：|若有任何疑問|電話：|院址：|意見信箱/,
  ];

  const contentParagraphs = (article.fullContent || article.excerpt || article.summary)
    .replace(/。(?=\S)/g, "。\n")
    .replace(/；(?=\S)/g, "；\n")
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .filter((paragraph) => paragraph.length >= 12)
    .filter((paragraph) => !noisePatterns.some((pattern) => pattern.test(paragraph)));

  return (
    <section className="workspace detail-page">
      <button className="ghost-btn" onClick={onBack}>
        <ArrowLeft size={18} />
        返回搜尋
      </button>

      <article className="article-detail">
        <img className="detail-hero" src={article.imageUrl} alt="" />
        <div className="detail-body">
          <div className="detail-heading">
            <span className="category">{article.category}</span>
            <h1>{article.title}</h1>
            <p>{article.summary}</p>
          </div>

          <div className="info-grid">
            <div>
              <Building2 size={18} />
              <span>來源院所</span>
              <strong>{article.clinicName}</strong>
            </div>
            <div>
              <CalendarDays size={18} />
              <span>索引日期</span>
              <strong>{new Date(article.crawledAt).toLocaleDateString("zh-TW")}</strong>
            </div>
            <div>
              <Stethoscope size={18} />
              <span>資料型態</span>
              <strong>{article.sourceType === "crawled" ? "爬蟲索引" : "範例資料"}</strong>
            </div>
          </div>

          <section className="detail-section">
            <h2>完整內容</h2>
            {contentParagraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>

          <section className="detail-section">
            <h2>關鍵詞</h2>
            <div className="keyword-row static">
              {article.keywords.map((keyword) => (
                <button
                  key={keyword}
                  onClick={() => {
                    onKeyword(keyword);
                    onBack();
                  }}
                >
                  {keyword}
                </button>
              ))}
            </div>
          </section>

          <a href={article.sourceUrl} target="_blank" rel="noreferrer" className="link-btn detail-link">
            開啟原始來源
            <ExternalLink size={17} />
          </a>
        </div>
      </article>
    </section>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [articles, setArticles] = useState([]);
  const [categories, setCategories] = useState(["全部"]);
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState("");
  const [adminData, setAdminData] = useState({ sources: [], crawlRuns: [] });
  const [crawlLoading, setCrawlLoading] = useState(false);
  const [view, setView] = useState("search");
  const [aiQuery, setAiQuery] = useState("");
  const [aiResult, setAiResult] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const searchInputRef = useRef(null);
  const aiPanelRef = useRef(null);

  useEffect(() => {
    const token = localStorage.getItem("health-search-token");
    if (!token) {
      setLoadingUser(false);
      return;
    }
    api("/api/me")
      .then((data) => setUser(data.user))
      .catch(() => localStorage.removeItem("health-search-token"))
      .finally(() => setLoadingUser(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    const timeout = setTimeout(() => {
      loadArticles();
    }, 180);
    return () => clearTimeout(timeout);
  }, [query, category, user]);

  useEffect(() => {
    if (user?.role === "admin") loadAdminData();
  }, [user]);

  async function loadArticles() {
    const params = new URLSearchParams({ query, category });
    const data = await api(`/api/articles?${params.toString()}`);
    setArticles(data.articles);
    setCategories(data.categories);
    setSelected((current) => {
      if (current && data.articles.some((article) => article.id === current.id)) return current;
      return data.articles[0] || null;
    });
  }

  async function loadAdminData() {
    const data = await api("/api/admin/sources");
    setAdminData(data);
  }

  async function runCrawler(sourceId, mode = "browser") {
    setCrawlLoading(true);
    const source = adminData.sources.find((item) => item.id === sourceId);
    setStatus(`正在更新 ${source?.clinicName || "指定來源"}，會讀取公開頁面的文字與相關圖片...`);
    try {
      const data = await api("/api/admin/crawl", {
        method: "POST",
        body: JSON.stringify({ sourceId, mode }),
      });
      setStatus(`${source?.clinicName || "來源"} 完成：新增或更新 ${data.run.found} 筆頁面。`);
      await loadArticles();
      await loadAdminData();
    } catch (err) {
      setStatus(err.message);
    } finally {
      setCrawlLoading(false);
    }
  }

  async function crawlAllSources(mode = "http") {
    setCrawlLoading(true);
    let total = 0;
    let skipped = 0;
    try {
      for (const source of adminData.sources) {
        setStatus(`正在更新 ${source.clinicName}...`);
        const data = await api("/api/admin/crawl", {
          method: "POST",
          body: JSON.stringify({ sourceId: source.id, mode }),
        });
        total += data.run.found;
        skipped += data.run.errors.length;
      }
      setStatus(`一鍵更新完成：新增或更新 ${total} 筆頁面，略過 ${skipped} 個不適合的頁面。`);
      await loadArticles();
      await loadAdminData();
    } catch (err) {
      setStatus(err.message);
    } finally {
      setCrawlLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem("health-search-token");
    setUser(null);
  }

  function openDetail(article) {
    setSelected(article);
    setView("detail");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function clearSearch() {
    setQuery("");
    setCategory("全部");
    setTimeout(() => searchInputRef.current?.focus(), 0);
  }

  function goToSearch() {
    setView("search");
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
      searchInputRef.current?.focus();
    }, 0);
  }

  function goToAiSearch() {
    setView("search");
    setTimeout(() => {
      aiPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      aiPanelRef.current?.querySelector("textarea")?.focus();
    }, 0);
  }

  async function runAiSearch(event) {
    event.preventDefault();
    if (!aiQuery.trim()) return;
    setAiLoading(true);
    try {
      const data = await api("/api/ai-search", {
        method: "POST",
        body: JSON.stringify({ query: aiQuery }),
      });
      setAiResult(data);
      if (data.inferredTerms?.[0]) {
        setQuery(data.inferredTerms[0]);
        setCategory("全部");
      }
    } catch (err) {
      setAiResult({ summary: err.message, notice: "", inferredTerms: [], articles: [] });
    } finally {
      setAiLoading(false);
    }
  }

  const totalKeywords = useMemo(
    () => Array.from(new Set(articles.flatMap((article) => article.keywords))).slice(0, 8),
    [articles],
  );

  const quickTopics = useMemo(() => {
    const defaults = ["糖尿病", "高血壓", "高血脂", "疫苗", "流感", "帶狀皰疹", "換藥", "傷口"];
    return Array.from(new Set([...defaults, ...articles.flatMap((article) => article.keywords)])).slice(0, 10);
  }, [articles]);

  const sourceHighlights = useMemo(() => {
    const counts = articles.reduce((result, article) => {
      result.set(article.clinicName, (result.get(article.clinicName) || 0) + 1);
      return result;
    }, new Map());
    return Array.from(counts, ([clinicName, count]) => ({ clinicName, count }))
      .sort((a, b) => b.count - a.count || a.clinicName.localeCompare(b.clinicName, "zh-Hant"))
      .slice(0, 5);
  }, [articles]);

  const stats = useMemo(
    () => [
      { label: "索引文章", value: articles.length },
      { label: "衛教分類", value: Math.max(categories.length - 1, 0) },
      { label: "資料來源", value: Array.from(new Set(articles.map((article) => article.clinicName))).length },
    ],
    [articles.length, categories.length],
  );

  const adminStats = useMemo(
    () => [
      { label: "啟用來源", value: adminData.sources.length },
      { label: "來源網址", value: adminData.sources.reduce((total, source) => total + source.urls.length, 0) },
      { label: "最近爬取", value: adminData.crawlRuns.length },
    ],
    [adminData],
  );

  if (loadingUser) return <div className="loading">系統載入中...</div>;
  if (!user) return <Login onLogin={setUser} />;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="app-logo">
          <Activity size={23} />
          <div>
            <strong>衛教搜尋</strong>
            <span>Health Education Index</span>
          </div>
        </div>
        <nav>
          <button className={view === "search" ? "active" : ""} onClick={goToSearch}>
            <Search size={18} />
            搜尋
          </button>
          {user.role === "admin" && (
            <button className={view === "admin" ? "active" : ""} onClick={() => setView("admin")}>
              <Bot size={18} />
              後台
            </button>
          )}
        </nav>
        <section className="sidebar-shortcuts">
          <span className="sidebar-label">快捷操作</span>
          <button className="sidebar-tab" onClick={goToAiSearch}>
            <Brain size={16} />
            AI 症狀搜尋
          </button>
        </section>
        <section className="sidebar-shortcuts">
          <span className="sidebar-label">熱門醫療院所</span>
          {sourceHighlights.slice(0, 5).map((source) => (
            <button
              key={source.clinicName}
              className={query === source.clinicName ? "sidebar-tab active" : "sidebar-tab"}
              onClick={() => {
                setView("search");
                setQuery(source.clinicName);
                setCategory("全部");
              }}
            >
              <Building2 size={16} />
              <span>{source.clinicName}</span>
            </button>
          ))}
          {(query || category !== "全部") && (
            <button className="sidebar-tab subtle" onClick={clearSearch}>
              <X size={16} />
              清除條件
            </button>
          )}
        </section>
        <div className="user-card">
          <div className="user-profile">
            <img src={user.avatarUrl} alt="" />
            <div>
              <span>Google 已登入</span>
              <strong>{user.name}</strong>
            </div>
          </div>
          <small>
            <Mail size={14} />
            {user.email}
          </small>
          <div className="user-meta-row">
            <span>{user.role === "admin" ? "管理員" : "使用者"}</span>
            <span>AI 搜尋可用</span>
          </div>
          <button className="logout-btn" onClick={logout}>
            <LogOut size={16} />
            登出
          </button>
        </div>
      </aside>

      {view === "detail" ? (
        <DetailPage article={selected} onBack={() => setView("search")} onKeyword={setQuery} />
      ) : view === "search" ? (
        <section className="workspace">
          <header className="topbar">
            <div>
              <p>醫療院所公開衛教索引</p>
              <h1>搜尋醫療院所提供的衛教資訊</h1>
              <div className="topbar-meta">
                <span>
                  <ShieldCheck size={15} />
                  已整理 {stats[0]?.value || 0} 筆衛教
                </span>
                <span>
                  <Building2 size={15} />
                  {stats[2]?.value || 0} 個資料來源
                </span>
                <span>
                  <Brain size={15} />
                  支援症狀式 AI 搜尋
                </span>
              </div>
            </div>
            <div className="topbar-actions">
              <button className="source-chip" onClick={goToAiSearch}>
                <Brain size={18} />
                AI 搜尋
              </button>
              <button className="source-chip" onClick={() => setQuery("彰仁外科家醫科診所")}>
                <Building2 size={18} />
                試作來源
              </button>
            </div>
          </header>

          <section className="insight-strip">
            {stats.map((item) => (
              <div key={item.label}>
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </div>
            ))}
            <p>整合公開衛教頁面的文字、圖片、分類與原始來源，方便快速找到可信入口。</p>
          </section>

          <section className="quick-hub">
            <div className="quick-panel">
              <div className="panel-kicker">
                <Sparkles size={18} />
                快速搜尋
              </div>
              <h2>常用衛教主題</h2>
              <div className="quick-actions">
                {quickTopics.map((topic) => (
                  <button
                    key={topic}
                    className={query === topic ? "active" : ""}
                    onClick={() => {
                      setQuery(topic);
                      setCategory("全部");
                    }}
                  >
                    <Search size={15} />
                    {topic}
                  </button>
                ))}
              </div>
            </div>

            <div className="quick-panel source-panel">
              <div className="panel-kicker">
                <Building2 size={18} />
                來源捷徑
              </div>
              <h2>依院所查看</h2>
              <div className="source-shortcuts">
                {sourceHighlights.map((source) => (
                  <button
                    key={source.clinicName}
                    onClick={() => {
                      setQuery(source.clinicName);
                      setCategory("全部");
                    }}
                  >
                    <span>{source.clinicName}</span>
                    <strong>{source.count}</strong>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="ai-search-panel" ref={aiPanelRef}>
            <div className="ai-copy">
              <div className="panel-kicker">
                <Brain size={18} />
                AI 輔助搜尋
              </div>
              <h2>輸入症狀，找出可能相關的衛教內容</h2>
              <p>例如：頭暈想睡、血壓偏高、傷口換藥、咳嗽發燒。系統會從已索引資料中整理建議閱讀方向。</p>
            </div>
            <form className="ai-form" onSubmit={runAiSearch}>
              <textarea
                value={aiQuery}
                onChange={(event) => setAiQuery(event.target.value)}
                placeholder="描述症狀或狀況，例如：最近常口渴、頻尿、體重下降..."
              />
              <button className="primary-btn compact" disabled={aiLoading}>
                <Brain size={18} />
                {aiLoading ? "分析中..." : "AI 搜尋"}
              </button>
            </form>
            {aiResult && (
              <div className="ai-result">
                <p>{aiResult.summary}</p>
                {aiResult.inferredTerms?.length > 0 && (
                  <div className="keyword-row static">
                    {aiResult.inferredTerms.map((term) => (
                      <button key={term} onClick={() => setQuery(term)}>
                        {term}
                      </button>
                    ))}
                  </div>
                )}
                <div className="ai-result-list">
                  {aiResult.articles.map((article) => (
                    <button
                      key={article.id}
                      onClick={() => {
                        const fullArticle = articles.find((item) => item.id === article.id) || article;
                        openDetail(fullArticle);
                      }}
                    >
                      <span>{article.category}</span>
                      <strong>{article.title}</strong>
                      <small>{article.clinicName}</small>
                    </button>
                  ))}
                </div>
                {aiResult.notice && <small className="ai-notice">{aiResult.notice}</small>}
              </div>
            )}
          </section>

          <section className="search-strip">
            <div className="search-box">
              <Search size={21} />
              <input
                ref={searchInputRef}
                placeholder="輸入糖尿病、高血壓、換藥、疫苗..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {(query || category !== "全部") && (
                <button className="clear-btn" onClick={clearSearch} aria-label="清除搜尋">
                  <X size={18} />
                  清除
                </button>
              )}
            </div>
            <label className="select-wrap">
              <Filter size={18} />
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                {categories.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
          </section>

          <section className="results">
            <div className="result-meta">
              <strong>{articles.length}</strong>
              <span>筆符合資料</span>
              <div className="keyword-row">
                {totalKeywords.map((item) => (
                  <button key={item} onClick={() => setQuery(item)}>
                    {item}
                  </button>
                ))}
              </div>
            </div>

            {articles.map((article) => (
              <article key={article.id} className="article-card" onClick={() => openDetail(article)}>
                <img className="article-thumb" src={article.imageUrl} alt="" />
                <div>
                  <span className="category">{article.category}</span>
                  <h2>{article.title}</h2>
                  <p>{article.summary}</p>
                </div>
                <footer>
                  <span>{article.clinicName}</span>
                  <span>{new Date(article.crawledAt).toLocaleDateString("zh-TW")}</span>
                </footer>
              </article>
            ))}
          </section>
        </section>
      ) : (
        <section className="workspace admin-workspace">
          <header className="topbar">
            <div>
              <p>管理後台</p>
              <h1>爬蟲來源與索引更新</h1>
              <div className="topbar-meta">
                <span>
                  <ShieldCheck size={15} />
                  {adminData.sources.length} 個來源
                </span>
                <span>
                  <ExternalLink size={15} />
                  {adminStats[1]?.value || 0} 個網址
                </span>
                <span>
                  <CalendarDays size={15} />
                  {adminData.crawlRuns[0] ? new Date(adminData.crawlRuns[0].startedAt).toLocaleDateString("zh-TW") : "尚未更新"}
                </span>
              </div>
            </div>
            <button className="primary-btn compact" onClick={() => crawlAllSources("http")} disabled={crawlLoading}>
              <Bot size={18} />
              {crawlLoading ? "更新中..." : "一鍵更新全部"}
            </button>
          </header>

          {status && <div className="status-line">{status}</div>}

          <section className="admin-summary">
            {adminStats.map((item) => (
              <div key={item.label}>
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </div>
            ))}
            <p>後台可管理公開衛教來源、手動更新索引，並檢查最近爬取是否成功。</p>
          </section>

          <section className="admin-toolbar">
            <button className="primary-btn compact" onClick={() => crawlAllSources("http")} disabled={crawlLoading}>
              <Bot size={18} />
              一鍵更新全部
            </button>
            <button className="secondary-btn compact" onClick={() => crawlAllSources("browser")} disabled={crawlLoading}>
              <Sparkles size={18} />
              深度瀏覽器更新
            </button>
            <span>HTTP 更新速度較快；瀏覽器更新適合需要動態渲染的來源。</span>
          </section>

          <section className="admin-grid">
            <section className="source-manager">
              <div className="section-heading">
                <div>
                  <p>來源清單</p>
                  <h2>醫療院所資料來源</h2>
                </div>
                <span>{adminData.sources.length} 個來源</span>
              </div>
              {adminData.sources.map((source) => (
                <article className="source-row" key={source.id}>
                  <div className="source-main">
                    <span className="source-icon">
                      <Building2 size={18} />
                    </span>
                    <div>
                      <h3>{source.clinicName}</h3>
                      <a href={source.baseUrl} target="_blank" rel="noreferrer">
                        {source.baseUrl}
                      </a>
                    </div>
                  </div>
                  <div className="source-meta">
                    <span>{source.urls.length} 個網址</span>
                    <span>{source.enabled ? "啟用中" : "已停用"}</span>
                  </div>
                  <details className="source-details">
                    <summary>查看網址</summary>
                    <div className="url-list">
                      {source.urls.map((url) => (
                        <a key={url} href={url} target="_blank" rel="noreferrer">
                          {url}
                        </a>
                      ))}
                    </div>
                  </details>
                  <div className="crawler-actions">
                    <button onClick={() => runCrawler(source.id, "http")} disabled={crawlLoading}>
                      HTTP 更新
                    </button>
                    <button onClick={() => runCrawler(source.id, "browser")} disabled={crawlLoading}>
                      瀏覽器更新
                    </button>
                  </div>
                </article>
              ))}
            </section>

            <aside className="admin-side">
              <div className="admin-card">
                <div className="admin-card-head">
                  <ShieldCheck size={20} />
                  <h2>爬取紀錄</h2>
                </div>
                <div className="run-list">
                  {adminData.crawlRuns.length === 0 && <p>尚無爬取紀錄。</p>}
                  {adminData.crawlRuns.map((run) => (
                    <div key={run.id}>
                      <strong className={run.status === "completed" ? "ok" : "warn"}>{run.status}</strong>
                      <span>
                        {run.mode} / {run.found} 筆 / {new Date(run.startedAt).toLocaleString("zh-TW")}
                      </span>
                      {run.errors.length > 0 && <small>{`${run.errors.length} 個錯誤，已略過不適合的頁面。`}</small>}
                    </div>
                  ))}
                </div>
              </div>
              <div className="admin-card admin-note">
                <div className="admin-card-head">
                  <Sparkles size={20} />
                  <h2>資料品質</h2>
                </div>
                <p>系統會自動略過列表頁、錯誤頁與不完整內容，避免搜尋結果出現選單、表單或無關圖片。</p>
              </div>
            </aside>
          </section>
        </section>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
