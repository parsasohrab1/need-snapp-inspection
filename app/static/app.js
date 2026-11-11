const OFFER_STATUS = {
  pending: "منتظر تأیید",
  accepted: "تأیید کرد و اعزام شد",
  lost: "بازرس دیگری زودتر تأیید کرد",
  declined: "رد کرد",
  expired: "مهلت تمام شد",
};

const STATUS = {
  planned: "برنامه‌ریزی‌شده",
  ready: "آماده اعزام",
  offering: "پیشنهاد نزد بازرس",
  assigned: "پذیرفته‌شده",
  en_route: "در مسیر",
  on_site: "در محل",
  submitted: "در انتظار بررسی هماهنگ‌کننده",
  accepted: "تأیید شده",
};

const ROLE_LABEL = {
  admin: "مدیر سامانه",
  coordinator: "هماهنگ‌کننده اعزام",
  manager: "مدیر پروژه",
  executive_manager: "مدیر اجرایی",
  unit_manager: "مدیر واحد",
  buyer: "کارفرما",
  vendor: "سازنده",
  inspector: "بازرس",
};

const app = document.querySelector("#app");
const state = { me: null, view: "desk", viewHistory: [], formReturnView: "desk", inRequestMode: false, buyerRequestPanels: [false, false], toast: "", pointId: null, draft: {}, caption: "شاهد کارگاهی", kind: "project", formKind: "ivr", formId: null, formSpec: null, requestPointId: null, requestPrefill: null, formDraft: null, managerTab: "overview", deskTimer: 0 };

function navigateTo(view) {
  if (state.view === view) return;
  state.viewHistory.push(state.view);
  state.view = view;
}

function resetFormState() {
  state.inRequestMode = false;
  state.formId = null;
  state.formDraft = null;
  state.requestPointId = null;
  state.requestPrefill = null;
}

function goBack() {
  const rootView = state.me?.role === "inspector" ? "dispatch" : "desk";
  const previousView = state.viewHistory.pop()
    || (state.view === "forms" ? state.formReturnView : rootView);
  if (state.view === "forms") resetFormState();
  state.view = previousView === state.view ? rootView : previousView;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

function money(value) {
  return `${Number(value || 0).toLocaleString("fa-IR")} ریال`;
}

function currentLocation() {
  if (!navigator.geolocation) {
    return Promise.reject(new Error("مرورگر شما از موقعیت جغرافیایی پشتیبانی نمی‌کند."));
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude }),
      (error) => {
        const messages = {
          1: "اجازه دسترسی به موقعیت را در مرورگر فعال کنید.",
          2: "موقعیت فعلی دریافت نشد؛ GPS یا خدمات مکان‌یابی را بررسی کنید.",
          3: "دریافت موقعیت بیش از حد طول کشید؛ دوباره تلاش کنید.",
        };
        reject(new Error(messages[error.code] || "دریافت موقعیت جغرافیایی ناموفق بود."));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

function toast(message) {
  state.toast = message;
  render();
  setTimeout(() => {
    if (state.toast === message) {
      state.toast = "";
      const node = document.querySelector(".toast");
      if (node) node.remove();
    }
  }, 4200);
}

async function api(path, options = {}) {
  const headers = options.body instanceof FormData ? {} : { "Content-Type": "application/json" };
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.detail || "درخواست انجام نشد");
  return data;
}

const DISC = {
  material: "مواد",
  welding: "جوش",
  ndt: "آزمون غیرمخرب",
  mechanical: "مکانیک",
  hydrotest: "هیدروتست",
  coating: "پوشش",
  documentation: "مدارک",
};

const DOC_TYPES = {
  drawing: "نقشه ساخت",
  mtc: "گواهی مواد",
  wps: "WPS",
  pqr: "PQR",
  ndt_procedure: "رویه NDT",
  test_procedure: "رویه آزمون",
  coating_spec: "مشخصات پوشش",
  packing_list: "پکینگ‌لیست",
  purchase_order: "سفارش خرید",
  origin_certificate: "گواهی مبدأ",
  model_3d: "مدل سه‌بعدی",
};

const IN_EN = {
  "شناسه": "Identification",
  "مشاهده": "Inspection details",
  "امضا": "Sign-off",
  "موقعیت کارفرما": "Employer location",
  "کارفرما": "Client",
  "شماره IN": "IN number",
  "تاریخ": "Date",
  "پروژه": "Project",
  "شماره سفارش": "Purchase order number",
  "شماره PI": "P/I number",
  "پیمانکار": "Contractor",
  "فروشنده": "Vendor",
  "سازنده": "Manufacturer",
  "تاریخ بازرسی": "Inspection date",
  "مدت زمان بازرسی": "Inspection duration",
  "اطلاعات تماس": "Contact details",
  "محل": "Location",
  "تگ تجهیز": "Equipment tag",
  "ردیف ITP": "ITP item",
  "نام بازرس": "Inspector",
  "تخصص": "Discipline",
  "مدرک مرجع": "Reference document",
  "مدارک مرجع": "Reference documents",
  "مواد و اقلام": "Materials and items",
  "دامنه بازرسی": "Inspection scope",
  "نوع: اطلاعات / پانچ / Hold": "Type: information / punch / hold",
  "متن یادداشت": "Observation",
  "اقدام بعدی": "Follow-up action",
  "مهلت اعلام قبلی": "Advance notice period",
  "توضیحات تکمیلی": "Additional remarks",
  "نام و امضای بازرس": "Inspector name and signature",
  "تاریخ امضا": "Signature date",
  "تأییدکننده و شرکت": "Acknowledged by and company",
  "تاریخ تأیید": "Acknowledgment date",
};

function localizeInSheet(sheet) {
  const copy = JSON.parse(JSON.stringify(sheet));
  copy.title_fa = copy.title;
  copy.note = "Complete all applicable details. The inspection request follows the approval workflow.";
  copy.sections = copy.sections.map((section) => ({
    ...section,
    title: IN_EN[section.title] || section.title,
    fields: section.fields.map((field) => ({ ...field, label: IN_EN[field.label] || field.label })),
  }));
  return copy;
}

async function boot() {
  try {
    state.me = await api("/api/me");
    state.viewHistory = [];
    if (state.me.role === "inspector") state.view = "dispatch";
  } catch {
    state.me = null;
  }
  render();
}

function shell(title, subtitle, body) {
  const items = [
    ["desk", "میز کار"],
    ["registration", "ثبت‌نام"],
    ["dispatch", "اعزام"],
    ["docs", "مدارک"],
    ["moms", "صورتجلسه‌ها"],
    ["forms", "فرم‌ها"],
    ["notifications", "اعلان‌ها"],
    ["archive", "آرشیو بازرسی"],
    ["people", state.me.role === "buyer" ? "بازرسی‌های انجام‌شده توسط این شرکت" : "بازرسان"],
    ["wallet", "تسویه"],
    ["benchmark", "بنچ‌مارک"],
    ["technology", "تکنولوژی"],
  ];
  const visibleItems = state.me.role === "buyer"
    ? items.filter(([id]) => !["dispatch", "forms", "benchmark", "technology"].includes(id))
    : items;
  if (state.me.role === "vendor") {
    const vendorItems = new Set(["desk", "docs", "notifications"]);
    for (let index = visibleItems.length - 1; index >= 0; index -= 1) {
      if (!vendorItems.has(visibleItems[index][0])) visibleItems.splice(index, 1);
    }
  }
  if (!["admin", "coordinator", "manager", "executive_manager"].includes(state.me.role)) {
    const registration = visibleItems.findIndex(([id]) => id === "registration");
    if (registration >= 0) visibleItems.splice(registration, 1);
  }
  if (state.me.role === "inspector") visibleItems.splice(2, 0, ["record", "کارنامه بازرسی"]);
  return `
    <div class="shell">
      <aside class="side">
        <div class="brand"><div class="mark">ب</div><div><b>اسنپ‌بازرس</b><small>ITP تا IVR</small></div></div>
        ${visibleItems.map(([id, label]) => `<button class="navbtn ${state.view === id ? "active" : ""}" data-act="goto" data-view="${id}">${label}</button>`).join("")}
        <div class="spacer"></div>
        <div class="who">${esc(state.me.name)}<br>${esc(ROLE_LABEL[state.me.role] || state.me.role)}${state.me.company ? `<br>${esc(state.me.company)}` : ""}</div>
        <button class="navbtn" data-act="logout">خروج</button>
      </aside>
      <section class="main ${state.view === "dispatch" ? "ride-main" : ""}">
        <div class="top">
          <div class="top-heading">
            <button class="back-button" data-act="back" aria-label="بازگشت به صفحه قبل" title="بازگشت به صفحه قبل" ${!state.viewHistory.length && state.view === (state.me.role === "inspector" ? "dispatch" : "desk") ? "disabled" : ""}><span aria-hidden="true">←</span><span>بازگشت</span></button>
            <div><h1>${title}</h1><p>${subtitle}</p></div>
          </div>
        </div>
        ${body}
      </section>
    </div>
    ${state.toast ? `<div class="toast">${esc(state.toast)}</div>` : ""}`;
}

function login() {
  const roles = [
    ["buyer", "کارفرما", "ثبت فرم IN و پیگیری درخواست بازرسی"],
    ["manager", "مدیر پروژه", "بررسی درخواست کارفرما و ارجاع به مدیر واحد"],
    ["unit.manager", "مدیر واحد", "تأیید تخصصی و ارسال پیشنهاد برای بازرس"],
    ["executive", "مدیر اجرایی", "تأیید نهایی و دسترسی کامل به فرم‌ها"],
    ["coordinator", "هماهنگ‌کننده اعزام", "پیگیری اعزام و گزارش‌های بازرسی"],
    ["inspector.reza", "بازرس جوش", "پذیرش پیشنهاد، حضور در کارگاه، IVR"],
    ["vendor", "سازنده", "بارگذاری مدارک و اعلام آمادگی"],
  ];
  app.innerHTML = `
    ${state.toast ? `<div class="toast">${esc(state.toast)}</div>` : ""}
    <div class="login">
      <section class="hero">
        <div class="mark">ب</div>
        <h1>بازرس، مثل سفر، پیشنهاد می‌گیرد.</h1>
        <p>برای هر نقطه ITP، مدارک باید آماده باشد. بعد سامانه به بازرس واجد شرایط و نزدیک کارگاه پیشنهاد می‌دهد. گزارش IVR با عکس، موقعیت و چک‌لیست بسته می‌شود.</p>
        <div class="steps">
          <div><span>۱</span> سازنده آمادگی نقطه را اعلام می‌کند</div>
          <div><span>۲</span> نزدیک‌ترین بازرس واجد شرایط اول درخواست را می‌بیند</div>
          <div><span>۳</span> هر بازرس ۳۰ دقیقه برای پذیرش فرصت دارد؛ سپس نفر بعدی</div>
          <div><span>۴</span> حضور در شعاع کارگاه، سپس IVR</div>
        </div>
      </section>
      <section class="panel">
        <h2>ورود به طرح فلامینگو</h2>
        <p class="hint">محیط اعتبارسنجی با کارگاه ماشین‌سازی البرز در کرج، هشت بازرس و چهل نقطه بازرسی.</p>
        <div class="roles">
          ${roles.map(([user, name, text]) => `<button class="role" data-act="login" data-user="${user}"><b>${name}</b><small>${text}</small></button>`).join("")}
        </div>
        <div class="pass">گذرواژه همه حساب‌های نمایشی: demo1234</div>
      </section>
    </div>`;
}

function ring(percent) {
  const radius = 46;
  const length = 2 * Math.PI * radius;
  const offset = length * (1 - Math.max(0, Math.min(percent, 100)) / 100);
  return `
    <svg class="ring" viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r="${radius}" fill="none" stroke="#e4eee6" stroke-width="12"></circle>
      <circle cx="60" cy="60" r="${radius}" fill="none" stroke="#12824d" stroke-width="12"
        stroke-linecap="round" stroke-dasharray="${length.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"
        transform="rotate(-90 60 60)"></circle>
      <text x="60" y="56" text-anchor="middle" font-size="22" font-weight="700" fill="#143026">${percent.toLocaleString("fa-IR")}</text>
      <text x="60" y="76" text-anchor="middle" font-size="11" fill="#5d6b63">درصد</text>
    </svg>`;
}

function jobCard(row) {
  return `
    <button class="job" data-act="open-point" data-id="${row.id}">
      <span class="job-top">
        <span class="tag">${esc(row.tag)}</span>
        <span class="ptype p-${esc(row.point_type)}">${esc(row.point_type)}</span>
      </span>
      <b>${esc(row.title)}</b>
      <small>${esc(row.discipline_label)} · ${esc(STATUS[row.status] || row.status)}</small>
      ${state.me.role !== "buyer" && row.dispatch_label ? `<span class="assignee">${esc(row.dispatch_label)}</span>` : ""}
      ${state.me.role !== "buyer" && !row.assignee && row.offered && row.offered.length ? `<span class="assignee wait">منتظر تأیید: ${esc(row.offered.join("، "))}</span>` : ""}
      <span class="job-flags">
        ${row.ncr_open ? `<span class="chip bad">عدم انطباق</span>` : ""}
        ${row.missing_docs.length ? `<span class="chip wait">مدارک ناقص</span>` : ""}
        ${row.remote_requested ? `<span class="chip">راه دور</span>` : ""}
      </span>
    </button>`;
}

function column(title, tone, rows, limit) {
  const shown = rows.slice(0, limit);
  const rest = rows.length - shown.length;
  return `
    <section class="col col-${tone}">
      <header><h3>${title}</h3><b>${rows.length.toLocaleString("fa-IR")}</b></header>
      ${shown.map(jobCard).join("") || `<p class="empty">این صف خالی است</p>`}
      ${rest > 0 ? `<p class="more">${rest.toLocaleString("fa-IR")} مورد دیگر در فهرست نقطه است</p>` : ""}
    </section>`;
}

function modeSwitch(modes) {
  const hint = {
    project: "چند تجهیز روی یک برنامه ITP",
    case: "یک قلم، جدا از برنامه پروژه",
  };
  return `<div class="modes">${(modes || []).map((item) => `
    <button class="mode ${state.kind === item.id ? "on" : ""}" data-act="kind" data-kind="${item.id}">
      <b>${esc(item.title)}</b>
      <small>${hint[item.id] || ""}</small>
      <em>${Number(item.points).toLocaleString("fa-IR")} نقطه · ${Number(item.accepted).toLocaleString("fa-IR")} تأیید شده</em>
    </button>`).join("")}</div>`;
}

function reportCard(row, actions) {
  return `
    <article class="picked ${row.result === "reject" ? "bad" : ""}">
      <button class="linkish" data-act="open-ivr" data-id="${row.visit_id}">
        <b>${esc(row.ivr_no)} · ${row.result === "reject" ? "رد" : "قبول"}</b>
        <small>${esc(row.tag)} · ${esc(row.title)} · ${esc(row.inspector)}</small>
        <em>${esc(row.defects[0] || row.note || "بدون ایراد")}</em>
      </button>
      ${actions || ""}
    </article>`;
}

function managerTray(reports) {
  const cards = (reports || []).map((row) => reportCard(row, `
    <div class="actions">
      ${row.result === "accept" ? `<button class="primary" data-act="review" data-id="${row.visit_id}" data-decision="approve">تأیید</button>` : ""}
      <button class="warn" data-act="review" data-id="${row.visit_id}" data-decision="return">برگرداندن</button>
    </div>`)).join("");
  return `<section class="card pad tray">
    <h3>کارتابل هماهنگ‌کننده / مدیر پروژه</h3>
    <p class="hint">گزارش بازرس همان لحظهٔ ثبت اینجا می‌نشیند. مغایرت برمی‌گردد و تأیید وارد کارتابل کارفرما می‌شود.</p>
    <div class="picked-list">${cards || `<p class="empty">گزارش تازه‌ای ننشسته است.</p>`}</div>
  </section>`;
}

function clientTray(reports) {
  const cards = (reports || []).map((row) => reportCard(row, `
    <div class="actions">
      <button class="primary" data-act="confirm-report" data-id="${row.visit_id}">تأیید کارفرما</button>
      <label>دلیل رد<input id="client-reject-note-${row.visit_id}" minlength="3" maxlength="2000" placeholder="در صورت رد، دلیل را بنویسید"></label>
      <button class="warn" data-act="client-reject-report" data-id="${row.visit_id}">رد گزارش</button>
    </div>`)).join("");
  return `<section class="card pad tray">
    <h3>کارتابل کارفرما</h3>
    <p class="hint">تأیید نهایی، صورت‌وضعیت و فاکتور را برای کارفرما صادر می‌کند.</p>
    <div class="picked-list">${cards || `<p class="empty">گزارش تأییدشده‌ای ننشسته است.</p>`}</div>
  </section>`;
}

function billBoard(bills) {
  const cards = (bills || []).map((bill) => `
    <article class="card pad bill">
      <div class="split">
        <h3>صورت‌وضعیت ${esc(bill.statement_no)}</h3>
        <span class="chip">${esc(bill.kind_label)}</span>
      </div>
      <p>فاکتور ${esc(bill.invoice_no)} · ${esc(bill.client)} · ${esc(bill.tag)} · ${esc(bill.title)}</p>
      <p class="hint">${esc(bill.ivr_no)} · ${esc(bill.company)}</p>
      <table class="bill-lines">
        <tbody>
          <tr><td>بهای بازرسی</td><td>${money(bill.gross_irr)}</td></tr>
          <tr><td>کسر حسن انجام تعهدات ${Number(bill.performance_rate).toLocaleString("fa-IR")}٪</td><td>${money(bill.performance_irr)}</td></tr>
          <tr><td>کسر سپرده بیمه ${Number(bill.insurance_rate).toLocaleString("fa-IR")}٪</td><td>${money(bill.insurance_irr)}</td></tr>
          <tr><td>مالیات تکلیفی ${Number(bill.tax_rate).toLocaleString("fa-IR")}٪</td><td>${money(bill.tax_irr)}</td></tr>
          <tr><td>افزودن ارزش افزوده ${Number(bill.vat_rate).toLocaleString("fa-IR")}٪</td><td>${money(bill.vat_irr)}</td></tr>
          <tr><td><b>خالص قابل پرداخت</b></td><td><b>${money(bill.net_irr)}</b></td></tr>
        </tbody>
      </table>
      <p><span class="chip ${bill.accounting_status === "returned" ? "bad" : bill.accounting_status === "overdue" ? "wait" : bill.accounting_status === "sent_to_accounting" ? "ok" : ""}">${esc({
        issued: "به ذی‌حسابی ارسال نشده",
        sent_to_accounting: "به ذی‌حسابی ارسال شده",
        returned: "مرجوع‌شده",
        overdue: "معوقه",
      }[bill.accounting_status] || bill.accounting_status)}</span></p>
      ${bill.accounting_note ? `<p class="hint">یادداشت وضعیت: ${esc(bill.accounting_note)}</p>` : ""}
      <div class="split claim-path">
        <span class="chip">وضعیت پرداخت</span>
        <span class="chip ${bill.claim_status === "paid" ? "ok" : bill.claim_status === "needs_correction" ? "bad" : "wait"}">${esc({
          unpaid: "پرداخت‌نشده",
          paid: "پرداخت‌شده",
          needs_correction: "نیازمند اصلاح",
        }[bill.claim_status] || "پرداخت‌نشده")}</span>
        <span class="hint">به‌روزرسانی: ${esc(bill.claim_updated_at ? faWhen(bill.claim_updated_at).date : "—")}</span>
      </div>
      ${bill.claim_note ? `<p class="hint">یادداشت Claim: ${esc(bill.claim_note)}</p>` : ""}
      <p class="hint">${esc(bill.basis)}</p>
      ${["manager", "admin"].includes(state.me.role) ? `
        <div class="archive-upload">
          <label>ارجاع به ذی‌حسابی
            <select id="bill-status-${bill.id}">
              ${[["issued", "ارسال نشده به ذی‌حسابی"], ["sent_to_accounting", "ارسال شده به ذی‌حسابی"]]
                .map(([value, label]) => `<option value="${value}" ${bill.accounting_status === value ? "selected" : ""}>${label}</option>`).join("")}
            </select>
          </label>
          <label>توضیح<input id="bill-note-${bill.id}" value="${esc(bill.accounting_note)}"></label>
          <button class="ghost" data-act="update-bill-status" data-id="${bill.id}">ثبت وضعیت</button>
          <label>وضعیت پرداخت
            <select id="claim-status-${bill.id}">
              ${[["unpaid", "پرداخت‌نشده"], ["paid", "پرداخت‌شده"]]
                .map(([value, label]) => `<option value="${value}" ${bill.claim_status === value ? "selected" : ""}>${label}</option>`).join("")}
            </select>
          </label>
          <label>توضیح پرداخت<input id="claim-note-${bill.id}" value="${esc(bill.claim_note)}"></label>
          <button class="ghost" data-act="update-claim-status" data-id="${bill.id}">ثبت وضعیت پرداخت</button>
        </div>` : ""}
    </article>`).join("");
  return `<section class="bills">
    <h3>صورت‌وضعیت و فاکتور</h3>
    ${cards || `<article class="card pad"><p class="empty">پس از تأیید نهایی بازرسی، صورت‌وضعیت اینجا برای کارفرما می‌نشیند.</p></article>`}
  </section>`;
}

function faWhen(iso) {
  if (!iso) return { date: "—", time: "—" };
  const value = new Date(String(iso).replace(" ", "T"));
  if (Number.isNaN(value.getTime())) return { date: String(iso).slice(0, 10), time: String(iso).slice(11, 16) };
  return {
    date: value.toLocaleDateString("fa-IR"),
    time: value.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" }),
  };
}

function faDigits(value) {
  return String(value || "—").replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[digit]);
}

function recordTable(rows) {
  const body = (rows || []).map((row) => {
    const when = faWhen(row.at);
    return `<tr>
      <td>${esc(when.time)}</td>
      <td>${esc(when.date)}</td>
      <td>${esc(row.company)}</td>
      <td>${esc(row.client)}</td>
      <td>${esc(faDigits(row.window))}</td>
      <td>${esc(row.ivr_no)}</td>
      <td>${esc(row.tag)} · ${esc(row.title)}</td>
      <td>${esc(row.workshop)}</td>
      <td>${esc(row.discipline)}</td>
      <td><button class="ghost" data-act="open-ivr" data-id="${row.visit_id}">گزارش</button></td>
    </tr>`;
  }).join("");
  return `<div class="tablewrap"><table class="record">
    <thead><tr>
      <th>زمان</th><th>تاریخ</th><th>نام شرکت</th><th>نام کارفرما</th><th>بازه زمانی بازرسی</th><th>شماره گزارش</th><th>موضوع</th><th>کارگاه</th><th>رشته</th><th></th>
    </tr></thead>
    <tbody>${body || `<tr><td colspan="10">پس از تأیید کارفرما، بازرسی‌های انجام‌شده اینجا می‌نشیند.</td></tr>`}</tbody>
  </table></div>`;
}

function managerInspectionList(rows, emptyText) {
  return `<div class="picked-list">${rows.map((row) => `
    <button class="picked" data-act="${row.visit_id ? "open-ivr" : "open-point"}" data-id="${row.visit_id || row.point_id}">
      <b>${esc(row.tag)} · ${esc(row.title)}</b>
      <small>${esc(row.project)} · ${esc(row.inspector || "بازرس تخصیص نیافته")} · ${esc(STATUS[row.status] || row.status)}</small>
      ${row.reason ? `<em>${esc(row.reason)}</em>` : ""}
    </button>`).join("") || `<p class="empty">${emptyText}</p>`}</div>`;
}

function managerTabButton(key, label, active) {
  return `<button class="ghost ${active === key ? "active" : ""}" data-act="manager-tab" data-tab="${key}">${label}</button>`;
}

function itpProjectChart(projects) {
  const maximum = Math.max(1, ...projects.map((project) => Number(project.itp_count || 0)));
  return `<article class="card pad">
    <h3>نمودار تعداد ITP به تفکیک پروژه</h3>
    <p class="hint">هر ITP مربوط به یک تجهیز دارای نقاط بازرسی است؛ تعداد ردیف‌های آن نیز در جدول پروژه‌ها آمده است.</p>
    <div class="itp-chart" role="img" aria-label="نمودار تعداد ITP به تفکیک پروژه">
      ${projects.map((project) => {
        const count = Number(project.itp_count || 0);
        const width = Math.max(0, Math.round((count / maximum) * 100));
        return `<div class="itp-chart-row">
          <span>${esc(project.code)} · ${esc(project.name)}</span>
          <div class="itp-chart-track"><i style="width:${width}%"></i></div>
          <b>${count.toLocaleString("fa-IR")}</b>
        </div>`;
      }).join("") || `<p class="empty">پروژه‌ای برای نمایش در نمودار ثبت نشده است.</p>`}
    </div>
  </article>`;
}

function managerDispatchList(rows) {
  return `<div class="picked-list">${rows.map((row) => `
    <button class="picked" data-act="open-point" data-id="${row.point_id}">
      <b>${esc(row.inspector || "در انتظار پذیرش بازرس")}</b>
      <small>${esc(row.project_code)} · ${esc(row.project)} · ${esc(row.tag)} · ${esc(row.title)}</small>
      <em>${esc(row.dispatch_sentence || `وضعیت: ${STATUS[row.status] || row.status}`)}</em>
      ${row.offered?.length ? `<small>پیشنهاد نزد: ${esc(row.offered.join("، "))}</small>` : ""}
    </button>`).join("") || `<p class="empty">اعزام فعالی وجود ندارد.</p>`}</div>`;
}

function buyerRequestTray(board) {
  const eligible = board.filter((row) =>
    ["draft", "documents_missing", "returned"].includes(row.request_status)
  );
  const requests = board.filter((row) => row.request_status !== "draft");
  const requestStatus = {
    documents_missing: "نقص مدارک",
    manager_review: "در انتظار بررسی مدیر پروژه",
    unit_review: "در انتظار بررسی مدیر واحد",
    executive_review: "در انتظار بررسی مدیر اجرایی",
    inspection_queue: "در کارتابل بازرسی",
    approved: "تأیید و ارسال به بازرس",
    approved_no_inspector: "تأییدشده؛ در انتظار بازرس",
    returned: "مرجوع‌شده؛ نیازمند اصلاح",
  };
  return `<section class="card pad">
    <h3>درخواست‌های بازرسی کارفرما</h3>
    <p class="hint">درخواست‌های ثبت‌شده را باز کنید یا برای یک نقطهٔ آماده، IN جدید بسازید.</p>
    <div class="buyer-request-panels">
      <details class="buyer-request-box" ${state.buyerRequestPanels[0] ? "open" : ""}>
        <summary><span>درخواست‌های ثبت‌شده</span><span class="chip">${requests.length.toLocaleString("fa-IR")}</span></summary>
        <div class="buyer-request-list">${requests.map((row) => `
          <div class="person">
            <span>${esc(row.tag)} · ${esc(row.title)}<small>${esc(row.project_name)} · ${esc(requestStatus[row.request_status] || row.request_status)}</small></span>
            <button class="ghost" data-act="open-point" data-id="${row.id}">مشاهده درخواست</button>
          </div>`).join("") || `<p class="empty">هنوز درخواستی ثبت نشده است.</p>`}</div>
      </details>
      <details class="buyer-request-box" ${state.buyerRequestPanels[1] ? "open" : ""}>
        <summary><span>ثبت IN جدید</span><span class="chip">${eligible.length.toLocaleString("fa-IR")}</span></summary>
        <div class="buyer-request-list">
          <p>همهٔ نقاط قابل درخواست از داخل یک فرم انتخاب می‌شوند.</p>
          <button class="primary" data-act="begin-in-request" ${eligible.length ? "" : "disabled"}>ایجاد درخواست IN جدید</button>
        </div>
      </details>
    </div>
  </section>`;
}

function inRequestPointChooser(board, selectedId) {
  const eligible = board.filter((row) =>
    ["draft", "documents_missing", "returned"].includes(row.request_status)
  );
  const grouped = new Map();
  eligible.forEach((row) => {
    const points = grouped.get(row.tag) || [];
    points.push(row);
    grouped.set(row.tag, points);
  });
  const selected = eligible.find((row) => row.id === selectedId);
  return `<details class="in-point-chooser" ${selected ? "" : "open"}>
    <summary>${selected
      ? `نقطهٔ انتخاب‌شده: ${esc(selected.tag)} · ${esc(selected.title)} — انتخاب نقطهٔ دیگر`
      : "انتخاب تجهیز و نقطهٔ بازرسی"}
    </summary>
    <p class="hint">ابتدا یک نقطه انتخاب کنید. فهرست به تفکیک تجهیز باز می‌شود.</p>
    ${[...grouped.entries()].map(([tag, points]) => `<details class="in-equipment-options">
      <summary>${esc(tag)} · ${esc(points[0].equipment)} <span class="chip">${points.length.toLocaleString("fa-IR")} نقطه</span></summary>
      <div class="in-point-options">${points.map((row) => `
        <button class="in-point-option ${row.id === selectedId ? "selected" : ""}" data-act="select-in-point" data-id="${row.id}">
          <b>${esc(row.title)}</b>
          <small>${esc(row.project_name)} · ${esc(row.discipline_label)} · ${esc(row.request_status === "draft" ? "آماده ثبت IN" : row.request_status === "returned" ? "مرجوع‌شده برای اصلاح" : "نقص مدارک")}</small>
        </button>`).join("")}</div>
    </details>`).join("") || `<p class="empty">نقطه‌ای برای ثبت IN موجود نیست.</p>`}
  </details>`;
}

async function renderManagerDesk() {
  const kindQuery = state.me.role === "manager" ? `?kind=${encodeURIComponent(state.kind)}` : "";
  const data = await api(`/api/manager/desk${kindQuery}`);
  const people = data.inspectors || [];
  const bills = data.statements || [];
  const activeTab = state.managerTab || "overview";
  const tabs = [
    ["overview", "نمای کلی"],
    ["dispatch", "اعزام و بازرس منتخب"],
    ["performed", "بازرسی‌های انجام‌شده"],
    ["completed", "تأییدشده توسط کارفرما"],
    ["review", "در انتظار بررسی گزارش"],
    ["rejected", "ردشده‌ها و دلیل رد"],
    ["missing", "نواقص مدارک"],
    ["unfinished", "انجام‌نشده / معوقه"],
    ["requests", "درخواست‌های IN"],
    ["claims", "صورت‌وضعیت و Claim"],
  ];
  const bodyByTab = {
    overview: `<section class="grid2">
      <article class="card pad"><h3>فهرست کارفرماها</h3>${(data.clients || []).map((client) => `<div class="person"><span>${esc(client.name)}</span></div>`).join("") || `<p class="empty">کارفرمایی ثبت نشده است.</p>`}</article>
      <article class="card pad"><h3>فهرست پروژه‌ها و تعداد ITP</h3><div class="tablewrap"><table><thead><tr><th>کد</th><th>پروژه</th><th>کارفرما</th><th>تعداد ITP</th><th>ردیف‌های ITP</th><th>ناقص</th><th>انجام‌نشده</th></tr></thead><tbody>
        ${(data.projects || []).map((project) => `<tr><td>${esc(project.code)}</td><td>${esc(project.name)}</td><td>${esc(project.buyer)}</td><td>${Number(project.itp_count || 0).toLocaleString("fa-IR")}</td><td>${Number(project.itp_point_count || project.inspection_count || 0).toLocaleString("fa-IR")}</td><td>${project.incomplete_count.toLocaleString("fa-IR")}</td><td>${project.not_done_count.toLocaleString("fa-IR")}</td></tr>`).join("") || `<tr><td colspan="7">پروژه‌ای ثبت نشده است.</td></tr>`}
      </tbody></table></div></article>
    </section>
    ${itpProjectChart(data.projects || [])}
    <article class="card pad"><h3>بازرس‌های شرکت</h3><div class="tablewrap"><table><thead><tr><th>نام</th><th>شهر</th><th>موقعیت (عرض، طول)</th><th>وضعیت</th><th>تخصص</th></tr></thead><tbody>
      ${people.map((person) => `<tr><td>${esc(person.name)}</td><td>${esc(person.city)}</td><td dir="ltr">${Number(person.lat).toFixed(5)}, ${Number(person.lng).toFixed(5)}</td><td>${person.online ? "آنلاین" : "آفلاین"}</td><td>${esc((person.discipline_labels || []).join("، "))}</td></tr>`).join("") || `<tr><td colspan="5">بازرسی ثبت نشده است.</td></tr>`}
    </tbody></table></div></article>`,
    performed: `<article class="card pad"><h3>بازرسی‌های انجام‌شده توسط شرکت</h3>${managerInspectionList(data.performed_reports || [], "گزارش بازرسی ثبت‌شده‌ای وجود ندارد.")}</article>`,
    dispatch: `<article class="card pad"><h3>بازرس انتخاب‌شده برای اعزام</h3>${managerDispatchList(data.selected_for_dispatch || [])}</article>`,
    completed: `<article class="card pad"><h3>بازرسی‌های تأییدشده توسط کارفرما</h3>${managerInspectionList((data.approved_reports || []).filter((row) => row.client_approved_at), "بازرسی تأییدشده‌ای وجود ندارد.")}</article>`,
    review: `<article class="card pad"><h3>گزارش‌های در انتظار بررسی</h3><p class="hint">برای بازبینی گزارش، جزئیات بازرسی را باز کنید.</p>${managerInspectionList(data.awaiting_report_review || [], "گزارشی در انتظار بررسی نیست.")}</article>`,
    rejected: `<article class="card pad"><h3>بازرسی‌های ردشده</h3>${managerInspectionList(data.rejected_reports || [], "گزارش ردشده‌ای وجود ندارد.")}</article>`,
    missing: `<article class="card pad"><h3>نواقص مدارک بازرسی</h3>${managerInspectionList((data.missing_documents || []).map((row) => ({ ...row, reason: row.missing_docs.join("، ") })), "مدرک ناقصی ثبت نشده است.")}</article>`,
    unfinished: `<section class="grid2">
      <article class="card pad"><h3>بازرسی‌های انجام‌شده با نقص</h3>${managerInspectionList(data.incomplete_inspections || [], "مورد ناقصی وجود ندارد.")}</article>
      <article class="card pad"><h3>بازرسی‌های انجام‌نشده</h3>${managerInspectionList(data.not_done_inspections || [], "بازرسی انجام‌نشده‌ای وجود ندارد.")}</article>
    </section>`,
    requests: `<article class="card pad"><h3>درخواست‌های IN</h3><div class="tablewrap"><table><thead><tr><th>شماره فرم</th><th>تاریخ</th><th>کارفرما</th><th>پروژه</th><th>تجهیز / بازرسی</th><th>وضعیت</th><th>اقدام</th></tr></thead><tbody>
      ${(data.in_forms || []).map((form) => `<tr><td>${esc(form.number || "—")}</td><td>${esc(form.date || "—")}</td><td>${esc(form.buyer)}</td><td>${esc(form.project)}</td><td>${esc(form.tag)} · ${esc(form.title)}</td><td>${esc({
        manager_review: "در انتظار مدیر پروژه",
        unit_review: "در انتظار مدیر واحد",
        executive_review: "در انتظار مدیر اجرایی",
        inspection_queue: "در کارتابل بازرسی",
        approved: "تأیید شده و ارجاع به بازرس",
        approved_no_inspector: "در انتظار بازرس آنلاین",
        documents_missing: "مدرک ناقص",
        returned: "مرجوع‌شده",
      }[form.request_status] || form.request_status)}</td><td><button class="ghost" data-act="open-sheet" data-id="${form.form_id}" data-kind="in">فرم</button> <button class="ghost" data-act="open-point" data-id="${form.point_id}">بررسی</button></td></tr>`).join("") || `<tr><td colspan="7">فرم IN ثبت‌شده‌ای موجود نیست.</td></tr>`}
    </tbody></table></div></article>`,
    claims: billBoard(bills),
  };
  app.innerHTML = shell(
    state.me.role === "manager" ? "میز کار مدیر پروژه" : "میز کار مدیر اجرایی",
    "گزارش‌های بازرسی، درخواست‌های IN و مسیر مالی پرونده‌ها.",
    `<div class="desk">
      <section class="kpis">
        <article class="kpi"><span>کارفرماها</span><strong>${(data.clients || []).length.toLocaleString("fa-IR")}</strong></article>
        <article class="kpi"><span>پروژه‌ها</span><strong>${(data.projects || []).length.toLocaleString("fa-IR")}</strong></article>
        <article class="kpi tone-red"><span>بازرسی‌های ناقص</span><strong>${(data.incomplete_inspections || []).length.toLocaleString("fa-IR")}</strong></article>
        <article class="kpi tone-amber"><span>بازرسی‌های انجام‌نشده</span><strong>${(data.not_done_inspections || []).length.toLocaleString("fa-IR")}</strong></article>
      </section>
      <section class="actions">${state.me.role === "manager" ? modeSwitch(data.modes) : ""}${tabs.map(([key, label]) => managerTabButton(key, label, activeTab)).join("")}</section>
      ${bodyByTab[activeTab] || bodyByTab.overview}
    </div>`
  );
  clearTimeout(state.deskTimer);
  state.deskTimer = setTimeout(() => {
    if (state.view === "desk" && ["manager", "executive_manager"].includes(state.me?.role)) render();
  }, 6000);
}

async function renderUnitManagerDesk() {
  const data = await api("/api/unit-manager/desk");
  app.innerHTML = shell(
    "کارتابل مدیر واحد",
    "درخواست‌های IN و گزارش‌های بازرسی ارجاع‌شده برای بررسی",
    `<article class="card pad"><h3>درخواست‌های IN</h3><div class="picked-list">${(data.requests || []).map((request) => `
      <div class="card pad">
        <h3>${esc(request.tag)} · ${esc(request.title)}</h3>
        <p>${esc(request.buyer)} · ${esc(request.project)} · واحد ${esc(request.department || request.discipline)}</p>
        ${request.request_note ? `<p class="hint">${esc(request.request_note)}</p>` : ""}
        <label class="signature-upload">مهر و امضای مدیر واحد<input id="request-unit-signature-${request.point_id}" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" required></label>
        <div class="actions">
          ${request.request_form_id ? `<button class="ghost" data-act="open-sheet" data-kind="in" data-id="${request.request_form_id}">مشاهده فرم IN</button>` : ""}
          <button class="ghost" data-act="open-point" data-id="${request.point_id}">جزئیات و گفتگو</button>
          <button class="primary" data-act="approve-request-unit" data-id="${request.point_id}">ثبت مهر و امضا، تأیید و ارسال به اسنپ</button>
          <button class="warn" data-act="return-request" data-id="${request.point_id}">مرجوع به مدیر پروژه</button>
        </div>
      </div>`).join("") || `<p class="empty">درخواستی برای واحد شما ارجاع نشده است.</p>`}</div></article>`
    + `<article class="card pad"><h3>گزارش‌های بازرسی در انتظار بررسی</h3><div class="picked-list">${(data.reports || []).map((report) => `
      <button class="picked" data-act="open-ivr" data-id="${report.visit_id}">
        <b>${esc(report.ivr_no)} · ${esc(report.tag)} · ${esc(report.title)}</b>
        <small>${esc(report.inspector)} · ${esc(report.result === "accept" ? "قبول بازرس" : "رد بازرس")}</small>
        ${report.review_note ? `<em>یادداشت قبلی: ${esc(report.review_note)}</em>` : ""}
        <span class="actions"><span class="chip">بازبینی و تصمیم</span></span>
      </button>`).join("") || `<p class="empty">گزارشی برای بررسی مدیر واحد نیست.</p>`}</div></article>`
  );
}

async function renderDesk() {
  if (["manager", "executive_manager"].includes(state.me.role)) {
    await renderManagerDesk();
    return;
  }
  if (state.me.role === "unit_manager") {
    await renderUnitManagerDesk();
    return;
  }
  const kind = state.kind === "case" ? "case" : "project";
  const manager = ["manager", "coordinator", "admin"].includes(state.me.role);
  const client = state.me.role === "buyer" || state.me.role === "admin";
  const requests = [
    api(`/api/dashboard?kind=${kind}`),
    api(`/api/board?kind=${kind}`),
    manager ? api("/api/reports/inbox") : Promise.resolve([]),
    client ? api("/api/reports/client") : Promise.resolve([]),
    client ? api("/api/bills") : Promise.resolve([]),
  ];
  const [dash, board, reports, released, bills] = await Promise.all(requests);
  const total = dash.points_total || 0;
  const accepted = dash.by_status.accepted || 0;
  const percent = total ? Math.round((accepted / total) * 100) : 0;
  const liveCount = ["offering", "assigned", "en_route", "on_site"].reduce((sum, key) => sum + (dash.by_status[key] || 0), 0);
  const rate = dash.acceptance_rate == null ? "—" : `${Math.round(dash.acceptance_rate * 100).toLocaleString("fa-IR")}٪`;
  const groups = {
    ready: board.filter((row) => (row.status === "ready" || row.status === "planned") && !row.ncr_open),
    live: board.filter((row) => ["offering", "assigned", "en_route", "on_site"].includes(row.status)),
    review: board.filter((row) => row.status === "submitted" || row.ncr_open),
    done: board.filter((row) => row.status === "accepted"),
  };
  const flow = [
    ["planned", "برنامه", "#8ea397"],
    ["ready", "آماده", "#1d4e73"],
    ["offering", "پیشنهاد", "#0f6b43"],
    ["assigned", "پذیرفته", "#14915a"],
    ["en_route", "در مسیر", "#3aa56e"],
    ["on_site", "در محل", "#67b48a"],
    ["submitted", "منتظر تأیید", "#c4842a"],
    ["accepted", "تأیید شده", "#0c3d28"],
  ].filter(([key]) => dash.by_status[key]);
  const equipment = [];
  const seen = new Map();
  board.forEach((row) => {
    if (!seen.has(row.tag)) {
      const bucket = { tag: row.tag, title: row.equipment, items: [] };
      seen.set(row.tag, bucket);
      equipment.push(bucket);
    }
    seen.get(row.tag).items.push(row);
  });
  const showMoney = ["coordinator", "buyer", "manager", "admin"].includes(state.me.role);
  const showOperationalDashboard = state.me.role !== "buyer";
  const caseMode = kind === "case";
  const pieces = new Set(board.map((row) => row.tag)).size;
  app.innerHTML = shell(
    state.me.role === "buyer" ? "میز کار کارفرما" : caseMode ? "بازرسی موردی" : "بازرسی پروژه‌ها",
    state.me.role === "buyer" ? "درخواست‌های بازرسی کارفرما · طرح فلامینگو" : caseMode ? "یک درخواست جدا، بدون برنامه چندنقطه‌ای" : "طرح فلامینگو · برنامه ITP تجهیزات ثابت",
    `<div class="desk">
      ${manager ? managerTray(reports) : ""}
      ${state.me.role === "buyer" ? buyerRequestTray(board) : ""}
      ${client ? clientTray(released) : ""}
      ${client ? billBoard(bills) : ""}
      ${showOperationalDashboard ? `
      <section class="hero-card">
        ${ring(percent)}
        <div>
          <p class="eyebrow">سلام ${esc(state.me.name)}</p>
          <h2>${accepted.toLocaleString("fa-IR")} نقطه از ${total.toLocaleString("fa-IR")} تأیید شده است</h2>
          <p>${caseMode ? "این درخواست داخل طرح فلامینگو نیست. مدارک همان قلم باید آماده باشد و بازرس مثل بقیه درخواست‌ها آن را می‌پذیرد." : "اعزام فقط بعد از کامل شدن مدارک انجام می‌شود. پذیرش بازرس ۳۰ دقیقه مهلت دارد."}</p>
        </div>
        <div class="hero-side">
          <span><b>${liveCount.toLocaleString("fa-IR")}</b> اعزام زنده</span>
          <span><b>${dash.open_ncr.toLocaleString("fa-IR")}</b> عدم انطباق باز</span>
          <span><b>${dash.offers_pending.toLocaleString("fa-IR")}</b> پیشنهاد نزد بازرس</span>
        </div>
      </section>
      <section class="kpis">
        <article class="kpi tone-ink"><span>همه نقاط</span><strong>${total.toLocaleString("fa-IR")}</strong><small>روی ${pieces.toLocaleString("fa-IR")} قلم</small></article>
        <article class="kpi tone-green"><span>نرخ پذیرش پیشنهاد</span><strong>${rate}</strong><small>قبول نسبت به رد و انقضا</small></article>
        <article class="kpi tone-amber"><span>در انتظار بررسی هماهنگ‌کننده</span><strong>${(dash.by_status.submitted || 0).toLocaleString("fa-IR")}</strong><small>منتظر تأیید یا برگرداندن</small></article>
        <article class="kpi tone-red"><span>صفحه باز عدم انطباق</span><strong>${dash.open_ncr.toLocaleString("fa-IR")}</strong><small>باید دوباره اعزام شود</small></article>
        ${showMoney ? `<article class="kpi tone-blue"><span>تسویه تأییدشده</span><strong>${money(dash.fees_irr)}</strong><small>سهم سامانه ${money(dash.commission_irr)}</small></article>` : ""}
      </section>
      <section class="card pad flow">
        <div class="split"><h3>جریان نقاط</h3><small>${total.toLocaleString("fa-IR")} نقطه</small></div>
        <div class="bar">${flow.map(([key, label, color]) => `<i style="width:${(dash.by_status[key] / total) * 100}%;background:${color}" title="${label}"></i>`).join("")}</div>
        <div class="legend">${flow.map(([key, label, color]) => `<span><i style="background:${color}"></i>${label} ${dash.by_status[key].toLocaleString("fa-IR")}</span>`).join("")}</div>
      </section>
      <section class="equips">
        ${equipment.map((item) => {
          const done = item.items.filter((row) => row.status === "accepted").length;
          const width = Math.round((done / item.items.length) * 100);
          const next = item.items.find((row) => row.status !== "accepted") || item.items[0];
          return `<button class="equip" data-act="open-point" data-id="${next.id}">
            <b>${esc(item.tag)}</b>
            <small>${esc(item.title)}</small>
            <span class="meter"><i style="width:${width}%"></i></span>
            <em>${done.toLocaleString("fa-IR")} از ${item.items.length.toLocaleString("fa-IR")}</em>
          </button>`;
        }).join("")}
      </section>
      ${!["buyer", "vendor"].includes(state.me.role) ? `<section class="card pad">
        <h3>بازرس انتخاب‌شده برای اعزام</h3>
        ${managerDispatchList([...groups.live, ...groups.review].map((row) => ({
          point_id: row.id,
          project: row.project_name,
          project_code: row.project_code,
          tag: row.tag,
          title: row.title,
          status: row.status,
          inspector: row.assignee,
          dispatch_sentence: row.dispatch_sentence,
          offered: row.offered,
        })))}
      </section>` : ""}
      <section class="columns">
        ${column("صف آمادگی", "ready", groups.ready, 6)}
        ${column("اعزام زنده", "live", groups.live, 6)}
        ${column("بازبینی و عدم انطباق", "review", groups.review, 6)}
        ${column("بسته شده", "done", groups.done, 5)}
      </section>
      ` : ""}
    </div>`
  );
  clearTimeout(state.deskTimer);
  if (manager || client) {
    state.deskTimer = setTimeout(() => {
      if (state.view === "desk") render();
    }, 6000);
  }
}

function rideMap(map, focusId) {
  const roads = `
    <rect width="760" height="640" fill="#e7edf2"></rect>
    <path d="M0 180 H760 M0 340 H760 M0 500 H760 M140 0 V640 M340 0 V640 M540 0 V640" stroke="#f7f9fb" stroke-width="18"></path>
    <path d="M40 80 C180 140 260 40 420 120 S680 200 740 90" fill="none" stroke="#d5dee6" stroke-width="10"></path>
    <path d="M20 420 C200 360 300 480 520 400 S700 460 760 390" fill="none" stroke="#d5dee6" stroke-width="10"></path>`;
  const pins = map.inspectors.flatMap((person) => {
    const pin = projectPin(person.lat, person.lng);
    if (!pin) return [];
    const y = pin.y + 40;
    const mine = person.id === focusId;
    const fill = person.engagement === "hourly" ? "#f4b000" : "#00a854";
    return [`
      ${mine ? `<circle cx="${pin.x}" cy="${y}" r="18" fill="none" stroke="${fill}" stroke-width="3"><animate attributeName="r" values="14;22;14" dur="1.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;.3;1" dur="1.6s" repeatCount="indefinite"/></circle>` : ""}
      <circle cx="${pin.x}" cy="${y}" r="${mine ? 9 : 7}" fill="${person.online ? fill : "#9aa6b2"}"></circle>
      <text x="${pin.x + 12}" y="${y + 4}" font-size="12" fill="#1d2b36">${esc(person.name.split(" ")[0])} · ${esc(person.engagement_label || "")}</text>`];
  });
  const shop = map.workshops[0];
  const shopPin = projectPin(shop.lat, shop.lng);
  const dest = `
    <path d="M${shopPin.x} ${shopPin.y + 18} c0 16 14 28 0 44 c-14-16 0-28 0-44z" fill="#111"></path>
    <circle cx="${shopPin.x}" cy="${shopPin.y + 30}" r="5" fill="white"></circle>
    <text x="${shopPin.x + 14}" y="${shopPin.y + 34}" font-size="13" font-weight="700" fill="#111">مقصد کارگاه</text>`;
  return `<svg viewBox="0 0 760 640" aria-label="نقشه اعزام">${roads}${pins.join("")}${dest}</svg>`;
}

function requestSheet(offer) {
  const remain = Math.max(0, Math.round((new Date(offer.offer.expires_at.replace(" ", "T")).getTime() - Date.now()) / 1000));
  const minutes = Math.floor(remain / 60);
  const seconds = remain % 60;
  return `
    <div class="handle"></div>
    <p class="eyebrow">درخواست بازرسی · ${esc(offer.offer.engagement_label || "بازرس")}</p>
    <h2>${esc(offer.equipment.tag)} · ${esc(offer.point.title)}</h2>
    <p>${esc(offer.equipment.workshop_name)} · ${Number(offer.offer.distance_km).toLocaleString("fa-IR")} کیلومتر</p>
    <div class="fare">
      <b>${money(offer.offer.total_inspector_irr || offer.offer.net_irr)}</b>
      ${offer.offer.travel_irr ? `<small>دستمزد پایه ${money(offer.offer.net_irr)} + ایاب‌وذهاب یک‌طرفه ${money(offer.offer.travel_irr)}</small>` : ""}
      <span>مهلت ${minutes.toLocaleString("fa-IR")}:${String(seconds).padStart(2, "0").replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[digit])}</span>
    </div>
    ${historyBlock(offer.history)}
    <button class="go" data-act="accept" data-id="${offer.offer.id}">قبول می‌کنم</button>
    <button class="nope" data-act="decline" data-id="${offer.offer.id}">رد، برو سراغ نفر بعدی</button>`;
}

function projectPin(lat, lng) {
  const minLat = 35.68;
  const maxLat = 35.84;
  const minLng = 50.9;
  const maxLng = 51.32;
  if (lat < minLat || lat > maxLat || lng < minLng || lng > maxLng) return null;
  return {
    x: ((lng - minLng) / (maxLng - minLng)) * 700 + 30,
    y: ((maxLat - lat) / (maxLat - minLat)) * 400 + 36,
  };
}

async function renderDispatch() {
  const [map, inbox, active, board] = await Promise.all([
    api("/api/map"),
    api("/api/offers/inbox"),
    api("/api/visits/active"),
    api("/api/board"),
  ]);
  const offer = inbox[0];
  const focusId = offer ? offer.offer.inspector_id : (active ? active.visit.inspector_id : null);
  let sheet = `
    <div class="handle"></div>
    <p class="eyebrow">در حال پیدا کردن بازرس</p>
    <h2>نزدیک‌ترین بازرس واجد شرایط</h2>
    <p>درخواست به‌ترتیب فاصله ارسال می‌شود. هر بازرس ۳۰ دقیقه برای پذیرش فرصت دارد؛ سپس پیشنهاد به نفر بعدی می‌رسد.</p>`;
  if (state.me.role === "inspector" && offer && !active) sheet = requestSheet(offer);
  else if (state.me.role === "inspector" && active) sheet = `<div class="handle"></div>${visitPhone(active)}`;
  else if (state.me.role !== "inspector") sheet = `<div class="handle"></div>${dispatchChoices(board)}`;
  app.innerHTML = shell(
    "اعزام",
    "",
    `<div class="ride">${rideMap(map, focusId)}<aside class="sheet">${sheet}</aside></div>`
  );
  clearTimeout(state.deskTimer);
  state.deskTimer = setTimeout(() => {
    if (state.view === "dispatch") render();
  }, 5000);
}

function dispatchChoices(board) {
  const rows = board.filter((row) => ["offering", "assigned", "en_route", "on_site", "submitted"].includes(row.status) || row.ncr_open);
  return `
    <h3>انتخاب سامانه</h3>
    <p class="hint">هر بار فقط یک بازرس: نزدیک‌ترین فرد واجد شرایط ۳۰ دقیقه فرصت پذیرش دارد؛ سپس پیشنهاد به نفر بعدی بر اساس فاصله می‌رسد.</p>
    <div class="stack">
      ${rows.map((row) => `
        <button class="picked" data-act="open-point" data-id="${row.id}">
          <b>${esc(row.assignee || "در انتظار تأیید")}</b>
          <small>${esc(row.kind_label || "")} · ${esc(row.tag)} · ${esc(row.title)} · ${esc(STATUS[row.status] || row.status)}</small>
          <em>${esc(row.dispatch_sentence)}</em>
        </button>`).join("") || `<p class="empty">اعزامی در جریان نیست.</p>`}
    </div>`;
}

const SHOTS = [
  ["item", "مورد بازرسی", "خود قطعه یا محل آزمون"],
  ["environment", "محیط", "فضای کارگاه اطراف کار"],
  ["marker", "پیکان‌کار", "نشانگر روی نقطهٔ مورد بازرسی"],
];

function shotBoard(active) {
  const photos = active.photos || [];
  return `<p class="hint">این عکس‌ها با دوربین گوشی در پرونده بازدید ثبت می‌شوند.</p><div class="shots">${SHOTS.map(([kind, label, hint]) => {
    const shot = photos.find((row) => row.kind === kind && row.url);
    const saved = photos.some((row) => row.kind === kind);
    return `<label class="shot">
      <b>${label}</b>
      <small>${hint}</small>
      ${shot ? `<img src="${esc(shot.url)}" alt="${esc(label)}">` : ""}
      <input type="file" accept="image/*" capture="environment" data-act="pick-photo" data-kind="${kind}" data-id="${active.visit.id}" ${active.visit.location_confirmed ? "" : "disabled"}>
      <em>${saved ? "ثبت شد" : "گرفتن با دوربین موبایل"}</em>
    </label>`;
  }).join("")}</div>`;
}

function visitPhone(active) {
  const phase = active.visit.phase;
  const equipment = active.context.equipment;
  const checks = active.context.point.checklist.map((item) => {
    const current = state.draft[item.id] || "pass";
    return `<div class="check"><b>${esc(item.text)}</b><div class="rowline">
      ${["pass", "fail", "na"].map((value) => `<label><input type="radio" name="c-${item.id}" data-act="answer" data-item="${esc(item.id)}" value="${value}" ${current === value ? "checked" : ""}> ${value === "pass" ? "قبول" : value === "fail" ? "رد" : "موضوعیت ندارد"}</label>`).join("")}
    </div></div>`;
  }).join("");
  const locationConfirmed = Boolean(active.visit.location_confirmed);
  return `
    <h2>${esc(equipment.tag)}</h2>
    <p>${esc(active.context.point.title)}</p>
    <p>مرحله: ${esc(STATUS[phase] || phase)}</p>
    ${historyBlock(active.context.history, active.visit.id)}
    <div class="actions">
      ${phase === "assigned" && !active.visit.remote ? `<button class="primary" data-act="enroute" data-id="${active.visit.id}">به سمت کارگاه</button>` : ""}
      ${phase === "assigned" && active.visit.remote ? `<button class="primary" data-act="remote" data-id="${active.visit.id}">شروع بازبینی مدارک</button>` : ""}
      ${phase === "en_route" ? `<button class="primary" data-act="arrive" data-id="${active.visit.id}">فعال‌سازی موقعیت و تأیید حضور در کارگاه</button>` : ""}
    </div>
    ${phase === "on_site" && active.visit.remote && !locationConfirmed ? `<p class="hint">برای فعال شدن چک‌لیست و پیوست گزارش، موقعیت جغرافیایی دستگاه را فعال و تأیید کنید.</p><button class="primary" data-act="confirm-location" data-id="${active.visit.id}">فعال‌سازی و تأیید موقعیت جغرافیایی</button>` : ""}
    ${phase === "on_site" && locationConfirmed ? `<div class="stack">${checks}${shotBoard(active)}<div class="actions"><button class="primary" data-act="submit-visit" data-id="${active.visit.id}" data-result="accept">ارسال قبول</button><button class="danger" data-act="submit-visit" data-id="${active.visit.id}" data-result="reject">ارسال رد</button></div></div>` : ""}`;
}

async function renderPoint() {
  const detail = await api(`/api/points/${state.pointId}`);
  const point = detail.point;
  const latest = detail.visits[detail.visits.length - 1];
  const unitManagers = state.me.role === "manager" && point.request_status === "manager_review"
    ? await api("/api/unit-managers")
    : [];
  const canReturn = (
    state.me.role === "manager" && point.request_status === "manager_review"
    || state.me.role === "unit_manager" && point.request_status === "unit_review"
    || state.me.role === "executive_manager" && point.request_status === "executive_review"
    || ["coordinator", "admin"].includes(state.me.role) && ["inspection_queue", "approved_no_inspector"].includes(point.request_status)
  );
  app.innerHTML = shell(
    `${detail.equipment.tag} — ${point.title}`,
    `${detail.project.name} · ${detail.companies.vendor}`,
    `<div class="grid2">
      <article class="card pad detail">
        <p class="chip ${detail.project.kind === "case" ? "wait" : "ok"}">${esc(detail.project.kind_label)} · ${esc(detail.project.code)}</p>
        ${detail.selection && detail.selection.sentence ? `<p class="dispatch-banner">${esc(detail.selection.sentence)}</p>` : ""}
        <div class="split">
          <span class="chip">${esc(STATUS[point.status] || point.status)}</span>
          <span class="chip ${point.point_type === "H" ? "hold" : ""}">${esc(point.point_type_label)}</span>
          <span class="chip">${esc(point.discipline_label)}</span>
          ${point.ncr_open ? `<span class="chip bad">NCR</span>` : ""}
        </div>
        <p>استاندارد: ${esc(point.standard_ref)}</p>
        <p>کارگاه: ${esc(detail.equipment.workshop_name)}، ${esc(detail.equipment.city)}</p>
        <p class="request-state">وضعیت درخواست: ${esc({
          draft: "ثبت نشده",
          documents_missing: "مدرک ناقص",
          manager_review: "در انتظار مدیر پروژه",
          executive_review: "در انتظار مدیر اجرایی",
          unit_review: "در انتظار مدیر واحد",
          inspection_queue: "در کارتابل بازرسی",
          approved: "تأیید و ارسال به بازرس",
          approved_no_inspector: "تأیید شده؛ در انتظار بازرس آنلاین",
          returned: "برگشت‌خورده برای اصلاح",
        }[point.request_status] || point.request_status)}</p>
        ${point.request_note ? `<p class="hint">${esc(point.request_note)}</p>` : ""}
        ${point.request_form_id && ["buyer", "manager", "executive_manager"].includes(state.me.role) ? `<button class="ghost" data-act="open-sheet" data-id="${point.request_form_id}" data-kind="in">مشاهده فرم IN کارفرما</button>` : ""}
        ${point.request_approvals?.length ? `<section class="request-approvals"><h3>مهر و امضاهای مراحل تأیید</h3><div class="approval-signatures">${point.request_approvals.map((approval) => `
          <article class="approval-signature">
            <p><b>${approval.stage === "manager" ? "مدیر پروژه" : "مدیر واحد"}</b> · ${esc(approval.actor)}</p>
            <small>${esc(approval.created_at)} · ${esc(approval.filename)}</small>
            <a href="${esc(approval.url)}" target="_blank" rel="noopener"><img src="${esc(approval.url)}" alt="مهر و امضای ${approval.stage === "manager" ? "مدیر پروژه" : "مدیر واحد"}"></a>
          </article>`).join("")}</div></section>` : ""}
        ${state.me.role === "manager" && point.request_status === "manager_review" ? `<div class="archive-upload">
          <label>واحد تخصصی<select id="request-department">${Object.entries(DISC).map(([key, label]) => `<option value="${esc(label)}" ${key === point.discipline ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label>
          <label>مدیر واحد<select id="request-unit-manager">${unitManagers.map((manager) => `<option value="${manager.id}">${esc(manager.name)}</option>`).join("")}</select></label>
          <label>یادداشت مدیر پروژه<input id="request-manager-note" value=""></label>
          <label class="signature-upload">مهر و امضای مدیر پروژه<input id="request-manager-signature" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" required></label>
        </div>` : ""}
        ${state.me.role === "unit_manager" && point.request_status === "unit_review" ? `<label class="signature-upload">مهر و امضای مدیر واحد<input id="request-unit-signature-${point.id}" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" required></label>` : ""}
        <h3>چک‌لیست</h3>
        <ul>${point.checklist.map((item) => `<li>${esc(item.text)}</li>`).join("")}</ul>
        <h3>مدارک لازم</h3>
        <p>${point.required_docs.map((doc) => esc(doc.label)).join("، ")}</p>
        ${point.missing_docs.length ? `<p class="chip wait">ناقص: ${point.missing_docs.map((doc) => esc(doc.label)).join("، ")}</p>` : `<p class="chip ok">مدارک این نقطه آماده‌اند</p>`}
        <div class="actions">
          ${state.me.role === "buyer" && ["draft", "documents_missing", "returned"].includes(point.request_status) ? `<button class="primary" data-act="open-request-form" data-id="${point.id}">ثبت فرم IN و ارسال درخواست</button>` : ""}
          ${state.me.role === "manager" && point.request_status === "manager_review" ? `<button class="primary" data-act="approve-request-manager" data-id="${point.id}">ثبت مهر و امضا، تأیید و ارجاع به مدیر واحد</button>` : ""}
          ${state.me.role === "unit_manager" && point.request_status === "unit_review" ? `<button class="primary" data-act="approve-request-unit" data-id="${point.id}">ثبت مهر و امضا و ارسال به اسنپ</button>` : ""}
          ${state.me.role === "executive_manager" && point.request_status === "executive_review" ? `<button class="primary" data-act="approve-request-executive" data-id="${point.id}">تأیید و ارسال پیشنهاد به نزدیک‌ترین بازرس</button>` : ""}
          ${state.me.role === "vendor" && ["planned", "ready"].includes(point.status) ? `<button class="primary" data-act="ready" data-id="${point.id}" data-remote="${point.remote_allowed ? "1" : "0"}">اعلام آمادگی</button>` : ""}
          ${["coordinator", "admin"].includes(state.me.role) && point.status === "ready" && point.request_status === "approved_no_inspector" ? `<button class="primary" data-act="broadcast" data-id="${point.id}">ارسال به بازرسان نزدیک</button>` : ""}
          ${latest ? `<button class="ghost" data-act="open-ivr" data-id="${latest.id}">گزارش IVR</button>` : ""}
          ${latest && latest.phase === "submitted" && ["manager", "coordinator", "admin"].includes(state.me.role) && latest.result === "accept" ? `<button class="primary" data-act="review" data-id="${latest.id}" data-decision="approve">تأیید و ارسال به کارفرما</button>` : ""}
          ${latest && latest.phase === "submitted" && ["manager", "coordinator", "admin"].includes(state.me.role) ? `<button class="warn" data-act="review" data-id="${latest.id}" data-decision="return">برگرداندن به‌خاطر مغایرت</button>` : ""}
        </div>
        ${canReturn ? `<div class="archive-upload">
          <label>دلیل مرجوعی<input id="request-return-reason" minlength="3" maxlength="2000" placeholder="دلیل مرجوعی را وارد کنید"></label>
          <button class="warn" data-act="return-request" data-id="${point.id}">مرجوع به مرحله قبل</button>
        </div>` : ""}
        <h3>گفتگو و یادداشت‌های درخواست</h3>
        <div class="picked-list">${(point.request_comments || []).map((comment) => `<div class="person"><span>${esc(comment.author)}: ${esc(comment.body)}</span><small>${esc(faWhen(comment.created_at).date)} ${esc(faWhen(comment.created_at).time)}</small></div>`).join("") || `<p class="empty">نظری ثبت نشده است.</p>`}</div>
        ${["admin", "coordinator", "executive_manager", "unit_manager", "manager", "buyer", "vendor"].includes(state.me.role) ? `<div class="archive-upload"><label>ثبت نظر<input id="request-comment-body" maxlength="4000" placeholder="یادداشت یا پاسخ"></label><button class="ghost" data-act="send-request-comment" data-id="${point.id}">ارسال نظر</button></div>` : ""}
      </article>
      <article class="card pad">
        <h3>پیشنهادها</h3>
        ${detail.offers.slice(0, 8).map((offer) => `<div class="person ${offer.status === "accepted" ? "chosen" : ""}"><span>${esc(offer.inspector)}${offer.status === "accepted" ? " · انتخاب شد" : ""}</span><small>${esc(OFFER_STATUS[offer.status] || offer.status)} · ${money(offer.total_inspector_irr || offer.net_irr)}${offer.travel_irr ? ` · ایاب‌وذهاب ${money(offer.travel_irr)}` : ""}</small></div>`).join("") || "<p>هنوز پیشنهادی نرفته است.</p>"}
        <h3>مراحل قبلی و ایرادها</h3>
        ${historyBlock(detail.history)}
        <h3>بازدیدها</h3>
        ${detail.visits.map((visit) => `<div class="person"><span>${esc(visit.inspector)}</span><small>${esc(visit.ivr_no || STATUS[visit.phase] || visit.phase)} · ${esc(visit.result === "accept" ? "قبول" : visit.result === "reject" ? "رد" : "جاری")}</small></div>`).join("") || "<p>بازدیدی ثبت نشده.</p>"}
      </article>
    </div>`
  );
}

async function renderIvr(visitId) {
  const report = await api(`/api/visits/${visitId}/ivr`);
  const canAttach = state.me.role === "inspector" && report.visit.location_confirmed && report.visit.phase === "on_site";
  const comments = report.comments || [];
  const stage = report.visit.report_stage;
  const reviewRole = state.me.role === "unit_manager" && stage === "unit_review"
    || state.me.role === "manager" && stage === "manager_review";
  const clientReview = state.me.role === "buyer" && stage === "client_review" && report.visit.phase === "client";
  const reviewControls = reviewRole ? `
    <label>یادداشت بررسی / دلیل مرجوعی<textarea id="review-note-${report.visit.id}" rows="3" maxlength="2000" placeholder="برای مرجوعی، دلیل را بنویسید"></textarea></label>
    <div class="actions">
      ${report.visit.result === "accept" ? `<button class="primary" data-act="review" data-id="${report.visit.id}" data-decision="approve">${stage === "unit_review" ? "تأیید و ارسال به مدیر پروژه" : "تأیید و ارسال به کارفرما"}</button>` : ""}
      <button class="warn" data-act="review" data-id="${report.visit.id}" data-decision="return">${stage === "unit_review" ? "مرجوع به بازرس برای اصلاح" : "مرجوع به مدیر واحد"}</button>
    </div>` : "";
  const clientControls = clientReview ? `
    <div class="actions">
      <button class="primary" data-act="confirm-report" data-id="${report.visit.id}">تأیید نهایی کارفرما و صدور صورتحساب</button>
      <label>دلیل نقص و مرجوعی به مدیر پروژه<input id="client-reject-note-${report.visit.id}" minlength="3" maxlength="2000"></label>
      <button class="warn" data-act="client-reject-report" data-id="${report.visit.id}">مرجوع به مدیر پروژه</button>
    </div>` : "";
  app.innerHTML = shell(
    report.visit.ivr_no,
    `${report.context.equipment.tag} · ${report.context.point.title}`,
    `<article class="card pad detail">
      <p>بازرس: ${esc(report.visit.inspector)} · ${esc(report.visit.city)}</p>
      <p>نتیجه: ${esc(report.visit.result === "accept" ? "قبول" : report.visit.result === "reject" ? "رد" : report.visit.result)} · ${esc(report.visit.report_stage_label || report.visit.phase)}</p>
      <p>${esc(report.visit.note)}</p>
      ${report.visit.review_note ? `<p class="chip wait">یادداشت مرجوعی: ${esc(report.visit.review_note)}</p>` : ""}
      ${report.visit.arrive_distance_km != null ? `<p>فاصله ورود تا کارگاه: ${Number(report.visit.arrive_distance_km).toLocaleString("fa-IR")} کیلومتر</p>` : ""}
      <h3>چک‌لیست</h3>
      <ul>${report.answers.map((row) => `<li>${esc(row.item_id)}: ${esc(row.value)} ${esc(row.note)}</li>`).join("")}</ul>
      <h3>پیوست‌های بازرسی</h3>
      <div class="gallery">${report.photos.map((row) => `<figure>${row.url ? (row.media_type?.startsWith("video/") ? `<video src="${esc(row.url)}" controls></video>` : row.media_type?.startsWith("image/") ? `<img src="${esc(row.url)}" alt="${esc(row.caption)}">` : `<a href="${esc(row.url)}">دریافت ${esc(row.filename || "فایل")}</a>`) : ""}<figcaption>${esc(row.kind === "environment" ? "محیط" : row.kind === "marker" ? "پیکان‌کار" : "مورد بازرسی")} · ${esc(row.caption || row.filename || "")}</figcaption></figure>`).join("") || "<p>پیوستی ثبت نشده است.</p>"}</div>
      ${canAttach ? `<div class="archive-upload"><label>بارگذاری عکس، ویدئو یا مدرک<input id="visit-attachment" type="file" accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt"></label><button class="primary" data-act="upload-visit-attachment" data-id="${report.visit.id}">پیوست به گزارش</button><p class="hint">بارگذاری فقط پس از تأیید موقعیت جغرافیایی فعال است.</p></div>` : ""}
      <h3>گفت‌وگو درباره گزارش</h3>
      <div class="stack">${comments.map((comment) => `<div class="person"><span><b>${esc(comment.author)}</b><small>${esc(comment.body)}</small></span><small>${esc(comment.created_at)}</small></div>`).join("") || "<p>نظری ثبت نشده است.</p>"}</div>
      <div class="archive-upload"><label>نظر یا درخواست اصلاح<textarea id="report-comment" rows="3" maxlength="4000"></textarea></label><button class="primary" data-act="send-comment" data-id="${report.visit.id}">ارسال نظر و اطلاع‌رسانی</button></div>
      <div class="timeline">${report.timeline.map((row) => `<div>${esc(row.at)} · ${esc(row.action)} ${esc(row.detail)}</div>`).join("")}</div>
      ${report.money ? `<p>دستمزد پایه ${money(report.money.fee_irr)} · ایاب‌وذهاب یک‌طرفه ${money(report.money.travel_irr)} · دریافتی بازرس ${money(report.money.net_irr)}</p>` : ""}
      ${reviewControls}
      ${clientControls}
      ${state.me.role !== "buyer" ? `<div class="actions"><button class="ghost" data-act="open-form" data-kind="ivr">فرم خالی IVR</button></div>` : ""}
    </article>`
  );
}

async function renderDocs() {
  const [docs, board] = await Promise.all([api("/api/documents"), api("/api/board")]);
  const equipment = [...new Map(board.map((row) => [row.equipment_id, row])).values()];
  const groupedDocs = new Map();
  for (const doc of docs) {
    const items = groupedDocs.get(doc.equipment_id) || [];
    items.push(doc);
    groupedDocs.set(doc.equipment_id, items);
  }
  const canUpload = ["vendor", "buyer", "coordinator", "admin"].includes(state.me.role);
  app.innerHTML = shell(
    "پرونده ساخت",
    "گواهی مواد، WPS، رویه آزمون، پکینگ‌لیست و نقشه. بدون مدرک لازم، نقطه آماده اعزام نمی‌شود.",
    `${canUpload ? `<article class="card pad archive-upload">
      <h3>بارگذاری مدرک واقعی</h3>
      <p class="hint">فایل‌های PDF، Office و تصویر تا ۱۰۰ مگابایت پذیرفته می‌شوند.</p>
      <div class="archive-upload-fields">
        <label>تجهیز<select id="document-equipment">${equipment.map((item) => `<option value="${item.equipment_id}">${esc(item.tag)} · ${esc(item.equipment)}</option>`).join("")}</select></label>
        <label>نوع مدرک<select id="document-type">${Object.entries(DOC_TYPES).map(([key, label]) => `<option value="${key}">${esc(label)}</option>`).join("")}</select></label>
        <label>فایل<input id="document-file" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png"></label>
        <button class="primary" data-act="upload-document">بارگذاری و ثبت</button>
      </div>
    </article>` : ""}
    <article class="card pad"><h3>پرونده‌های هر تجهیز</h3>
      ${equipment.map((item) => {
        const files = groupedDocs.get(item.equipment_id) || [];
        return `<details class="archive-equipment">
          <summary><b>${esc(item.tag)}</b> · ${esc(item.equipment)} <span class="chip">${files.length.toLocaleString("fa-IR")} مدرک</span></summary>
          <div class="tablewrap"><table><thead><tr><th>نوع</th><th>پرونده</th><th>دسترسی</th></tr></thead><tbody>
            ${files.map((doc) => `<tr><td>${esc(doc.label)}</td><td>${esc(doc.filename)}</td><td>${doc.download_url ? `<a href="${esc(doc.download_url)}">دریافت فایل</a>` : "فقط نام فایل ثبت شده؛ فایل واقعی موجود نیست"}</td></tr>`).join("") || `<tr><td colspan="3">مدرکی برای این تجهیز ثبت نشده است.</td></tr>`}
          </tbody></table></div>
        </details>`;
      }).join("") || `<p class="empty">تجهیزی ثبت نشده است.</p>`}
    </article>`
  );
}

function archivePhoto(photo) {
  return `<figure class="archive-photo">
    ${photo.url ? `<a href="${esc(photo.url)}" target="_blank" rel="noopener"><img src="${esc(photo.url)}" alt="${esc(photo.label)}"></a>` : `<div class="archive-photo-empty">فایل عکس ثبت نشده</div>`}
    <figcaption>${esc(photo.label)} · ${esc(photo.caption)}</figcaption>
  </figure>`;
}

async function renderArchive() {
  const projects = await api("/api/archive/projects");
  const cards = projects.map((project) => `
    <article class="card pad archive-project">
      <div class="split">
        <div><p class="eyebrow">${esc(project.code)} · پروژه مناقصه‌ای</p><h2>${esc(project.name)}</h2></div>
        <button class="ghost" data-act="print-archive">چاپ آرشیو</button>
      </div>
      <p>${esc(project.buyer)} · ${esc(project.vendors.join("، "))} · سفارش ${esc(project.purchase_orders.join("، "))}</p>
      <div class="archive-stats">
        <span>${project.completed_points.toLocaleString("fa-IR")} از ${project.total_points.toLocaleString("fa-IR")} نقطه دارای گزارش تأییدشده</span>
        <span>${project.reports.toLocaleString("fa-IR")} گزارش · ${project.client_approved_reports.toLocaleString("fa-IR")} تأیید نهایی کارفرما</span>
      </div>
      ${project.equipment.map((item) => `
        <section class="archive-equipment">
          <h3>${esc(item.tag)} · ${esc(item.title)}</h3>
          <p class="hint">${esc(item.workshop)}</p>
          <h4>مدارک بارگذاری‌شده</h4>
          <ul class="archive-docs">${item.documents.map((doc) => `<li><span>${esc(doc.label)} · ${esc(doc.filename)} · ${esc(doc.uploaded_by || "نامشخص")}</span>${doc.download_url ? `<a href="${esc(doc.download_url)}">مشاهده فایل</a>` : `<small>نام فایل ثبت شده؛ فایل واقعی در آرشیو نیست</small>`}</li>`).join("") || `<li>مدرکی ثبت نشده است.</li>`}</ul>
          ${item.completed_points.map((point) => `
            <section class="archive-inspection">
              <h4>${point.seq.toLocaleString("fa-IR")}. ${esc(point.title)} · ${esc(point.discipline)}</h4>
              ${point.reports.map((report) => `
                <article class="archive-report">
                  <div class="split">
                    <b>${esc(report.ivr_no)} · بازرس: ${esc(report.inspector || "نامشخص")}</b>
                    <span class="chip ${report.signature_verified ? "ok" : "wait"}">${report.signature_verified ? "ثبت سامانه‌ای با حساب بازرس" : "امضای سامانه‌ای قابل تأیید نیست"}</span>
                  </div>
                  <p>ثبت گزارش: ${esc(report.signed_at || report.submitted_at || "نامشخص")} · ${report.client_approved ? "تأیید نهایی کارفرما" : "در انتظار تأیید نهایی کارفرما"}</p>
                  ${report.signed_by ? `<p>ثبت‌کنندهٔ رویداد امضا: ${esc(report.signed_by)}</p>` : ""}
                  <button class="ghost" data-act="open-ivr" data-id="${report.visit_id}">مشاهده گزارش و چک‌لیست</button>
                  <h5>عکس‌های محل و تجهیزات بازرسی</h5>
                  <div class="archive-gallery">${report.photos.map(archivePhoto).join("") || `<p>عکسی برای این گزارش ثبت نشده است.</p>`}</div>
                </article>`).join("")}
            </section>`).join("") || `<p class="hint">گزارش بازرسی تأییدشده‌ای برای این تجهیز نیست.</p>`}
        </section>`).join("")}
    </article>`).join("");
  app.innerHTML = shell(
    "آرشیو پروژه‌های بازرسی",
    "پروژه‌های دارای سفارش خرید و گزارش بازرسی تأییدشده؛ شامل مدارک، گزارش ثبت‌شده با حساب بازرس و عکس‌های محل و تجهیزات.",
    `<div class="archive-list">${cards || `<article class="card pad empty">هنوز پروژه‌ای با گزارش بازرسی تأییدشده در آرشیو وجود ندارد.</article>`}</div>`
  );
}

async function renderMoms() {
  const moms = await api("/api/moms");
  app.innerHTML = shell(
    "صورتجلسه‌ها",
    "MOM جلسه هماهنگی، جدا از گزارش بازدید است.",
    `<div class="detail">${moms.map((mom) => `<article class="card pad"><h3>${esc(mom.title)}</h3><p>${esc(mom.held_on)} · ${esc(mom.attendees)}</p><p>${esc(mom.body)}</p></article>`).join("")}
      <article class="card pad"><h3>صورتجلسه تازه</h3><p>فرم MOM جاهای خالی حاضرین، اقدام و امضا دارد.</p><button class="primary" data-act="open-form" data-kind="mom">فرم خالی MOM</button></article>
    </div>`
  );
}

function historyBlock(rows, currentVisitId) {
  const prior = (rows || []).filter((row) => row.visit_id !== currentVisitId);
  if (!prior.length) return `<p class="hint">گزارش مرحلهٔ قبلی برای این تجهیز نیست.</p>`;
  return `<section class="history"><h3>بازرسی‌های قبلی</h3>${prior.map((row) => `
    <article class="past ${row.defects.length ? "bad" : ""}">
      <b>${row.seq.toLocaleString("fa-IR")}. ${esc(row.title)}${row.same_point ? " · همین نقطه" : ""}</b>
      <small>${esc(row.ivr_no)} · ${esc(row.inspector)} · ${row.result === "reject" ? "رد شده" : row.result === "accept" ? "قبول شده" : "جاری"}</small>
      ${row.note ? `<p>${esc(row.note)}</p>` : ""}
      ${row.defects.length ? `<ul>${row.defects.map((defect) => `<li>${esc(defect.text)} — ${esc(defect.note)}</li>`).join("")}</ul>` : `<p>ایرادی ثبت نشده</p>`}
      <button class="ghost" data-act="open-ivr" data-id="${row.visit_id}">گزارش این مرحله</button>
    </article>`).join("")}</section>`;
}

function blankControl(field, value, disabled = false) {
  const wide = field.kind === "area" ? " span2" : "";
  const readonly = disabled ? " disabled" : "";
  const required = field.required && !disabled ? " required aria-required=\"true\"" : "";
  const label = `${esc(field.label)}${field.required ? ` <b class="required-star" aria-hidden="true">*</b>` : ""}`;
  if (field.kind === "select" && field.key === "customer_location") {
    const selected = value || "iran";
    const options = selected === "international"
      ? [["iran", "Iran"], ["international", "International / خارج از ایران"]]
      : [["iran", "ایران / داخل کشور"], ["international", "International / خارج از ایران"]];
    return `<label class="blank"><span>${label}</span><select data-form-key="${esc(field.key)}"${readonly}${required}>${options.map(([key, label]) => `<option value="${key}" ${selected === key ? "selected" : ""}>${label}</option>`).join("")}</select></label>`;
  }
  if (field.kind === "area") {
    return `<label class="blank${wide}"><span>${label}</span><textarea data-form-key="${esc(field.key)}" rows="3"${readonly}${required}>${esc(value || "")}</textarea></label>`;
  }
  return `<label class="blank${wide}"><span>${label}</span><input data-form-key="${esc(field.key)}" value="${esc(value || "")}"${readonly}${required}></label>`;
}

function prefillInspectionRequest(detail) {
  return {
    customer_location: "iran",
    client: detail.companies.buyer,
    project: detail.project.name,
    po: detail.order.number,
    contractor: detail.companies.vendor,
    vendor: detail.companies.vendor,
    manufacturer: detail.companies.vendor,
    location: `${detail.equipment.workshop_name}، ${detail.equipment.city}`,
    tag: detail.equipment.tag,
    itp_item: String(detail.point.seq),
    discipline: detail.point.discipline_label,
    reference: detail.point.standard_ref,
    scope: detail.point.title,
    category: "درخواست بازرسی",
  };
}

function blankTable(table, rows, disabled = false) {
  const readonly = disabled ? " disabled" : "";
  const body = (rows || []).map((row, index) => `<tr>${table.columns.map((column) => {
    const required = column.required && index === 0 && !disabled ? " required aria-required=\"true\"" : "";
    return `<td><input data-form-table="${esc(table.key)}" data-row="${index}" data-col="${esc(column.key)}" value="${esc((row || {})[column.key] || "")}"${readonly}${required}></td>`;
  }).join("")}</tr>`).join("");
  return `<div class="tablewrap"><table class="blanksheet"><thead><tr>${table.columns.map((column) => `<th>${esc(column.label)}${column.required ? ` <b class="required-star" aria-hidden="true">*</b>` : ""}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function collectForm() {
  const spec = state.formSpec;
  const payload = {};
  document.querySelectorAll("[data-form-key]").forEach((el) => {
    payload[el.dataset.formKey] = el.value;
  });
  (spec.tables || []).forEach((table) => {
    payload[table.key] = [];
    for (let index = 0; index < table.rows; index += 1) {
      const row = {};
      table.columns.forEach((column) => {
        const input = document.querySelector(`[data-form-table="${table.key}"][data-row="${index}"][data-col="${column.key}"]`);
        row[column.key] = input ? input.value : "";
      });
      payload[table.key].push(row);
    }
  });
  if (spec.tail) {
    spec.tail.fields.forEach((field) => {
      const input = document.querySelector(`[data-form-key="${field.key}"]`);
      payload[field.key] = input ? input.value : "";
    });
  }
  return payload;
}

async function renderForms() {
  const kind = state.inRequestMode || state.requestPointId ? "in" : state.me.role === "buyer" ? "in" : state.formKind || "ivr";
  const [sheet, saved, requestBoard] = await Promise.all([
    state.formId ? api(`/api/forms/${state.formId}`) : api(`/api/forms/template/${kind}`),
    (state.me.role === "manager" && kind === "in") || (state.me.role === "buyer" && !state.requestPointId)
      ? Promise.resolve([])
      : api(`/api/forms?kind=${kind}`),
    state.inRequestMode ? api(`/api/board?kind=${state.kind === "case" ? "case" : "project"}`) : Promise.resolve([]),
  ]);
  if (state.requestPrefill && !state.formId) sheet.payload = { ...sheet.payload, ...state.requestPrefill };
  if (state.formDraft && !state.formId) sheet.payload = { ...sheet.payload, ...state.formDraft };
  const displaySheet = kind === "in" && sheet.payload.customer_location === "international"
    ? localizeInSheet(sheet)
    : sheet;
  state.formSpec = sheet;
  const viewOnly = (state.me.role === "manager" && kind === "in" && Boolean(state.formId))
    || (state.me.role === "buyer" && !state.inRequestMode);
  const formDisabled = viewOnly || (state.inRequestMode && !state.requestPointId);
  const canSubmitRequest = state.inRequestMode && Boolean(state.requestPointId);
  const tabs = state.me.role === "executive_manager"
    ? [["in", "IN"], ["itp", "ITP"], ["ivr", "IVR"], ["mom", "MOM"]]
    : state.me.role === "buyer" ? [["in", "IN"]] : [["ivr", "IVR"]];
  app.innerHTML = shell(
    `${displaySheet.code} · ${displaySheet.title_fa}`,
    displaySheet.title,
    `<div class="formpage">
      <div class="formtabs">
        ${tabs.map(([id, label]) => `<button class="ghost ${kind === id ? "on" : ""}" data-act="form-kind" data-kind="${id}">${label}</button>`).join("")}
        ${canSubmitRequest ? `<label><input id="request-remote" type="checkbox"> درخواست بازرسی از راه دور</label>` : ""}
        ${!state.requestPointId ? `<button class="ghost" data-act="new-form">فرم تازه</button>` : ""}
        <button class="ghost" data-act="print-form">چاپ</button>
        ${!viewOnly && (!state.inRequestMode || canSubmitRequest) ? `<button class="primary" data-act="save-form">${canSubmitRequest ? "ثبت نهایی IN و ارسال به کارتابل مدیر پروژه" : "ثبت جاهای پر شده"}</button>` : ""}
      </div>
      ${state.inRequestMode ? inRequestPointChooser(requestBoard, state.requestPointId) : ""}
      ${state.inRequestMode && !state.requestPointId ? `<p class="chip wait">برای تکمیل فرم، ابتدا نقطهٔ بازرسی را از فهرست بالا انتخاب کنید.</p>` : ""}
      <div class="formlayout">
        <article class="sheet" id="sheet">
          <header class="sheet-head">
            <div><b>${esc(displaySheet.code)}</b><h2>${esc(displaySheet.title)}</h2><p>${esc(displaySheet.title_fa)}</p></div>
            <div class="sheet-no"><span>شماره</span><strong>${esc(sheet.payload.number || "—")}</strong></div>
          </header>
          <p class="hint">${esc(displaySheet.note)}</p>
          ${displaySheet.sections.map((section) => `<section><h3>${esc(section.title)}</h3><div class="blanks">${section.fields.map((field) => blankControl(field, sheet.payload[field.key], formDisabled)).join("")}</div></section>`).join("")}
          ${(displaySheet.tables || []).map((table) => `<section><h3>${esc(table.title)}</h3>${blankTable(table, sheet.payload[table.key], formDisabled)}</section>`).join("")}
          ${displaySheet.tail ? `<section><h3>${esc(displaySheet.tail.title)}</h3><div class="blanks">${displaySheet.tail.fields.map((field) => blankControl(field, sheet.payload[field.key], formDisabled)).join("")}</div></section>` : ""}
        </article>
        <aside class="card pad">
          <h3>پیش‌نویس‌های ${esc(sheet.code)}</h3>
          <div class="stack">
            ${saved.map((item) => `<button class="picked" data-act="open-sheet" data-id="${item.id}" data-kind="${item.kind}"><b>${esc(item.number)}</b><small>${esc(item.updated_at)}</small></button>`).join("") || `<p class="empty">هنوز فرمی ثبت نشده. جاهای خالی را پر کنید.</p>`}
          </div>
        </aside>
      </div>
      ${canSubmitRequest ? `<div class="form-submit-sticky">
        <p><b>ثبت نهایی درخواست بازرسی</b><span>فرم IN ذخیره و برای بررسی به کارتابل مدیر پروژه ارسال می‌شود.</span></p>
        <button class="primary" data-act="save-form">ثبت نهایی IN و ارسال به کارتابل مدیر پروژه</button>
      </div>` : ""}
    </div>`
  );
}

async function renderNotifications() {
  const rows = await api("/api/notifications");
  app.innerHTML = shell(
    "اعلان‌ها",
    "پیام‌های مربوط به درخواست‌های بازرسی، گزارش‌ها و مدارک ناقص.",
    `<article class="card pad stack">${rows.map((row) => row.target?.type === "ivr"
      ? `<button class="notification-link" data-act="open-ivr" data-id="${row.target.id}">
          <span><b>${esc(row.title)}</b><small>${esc(row.body)}</small></span>
          <span class="notification-action">${row.read ? "مشاهدهٔ گزارش" : "جدید · مشاهدهٔ گزارش"}</span>
        </button>`
      : `<div class="person"><span><b>${esc(row.title)}</b><small>${esc(row.body)}</small></span><small>${row.read ? "خوانده‌شده" : "جدید"}</small></div>`
    ).join("") || `<p class="empty">اعلانی ثبت نشده است.</p>`}</article>`
  );
}

function renderRegistration() {
  app.innerHTML = shell(
    "ثبت‌نام اعضا",
    "پیش‌نمایش اطلاعات هویتی و فایل‌های موردنیاز",
    `<article class="card pad">
      <p class="chip wait">بارگذاری مهر و امضا در فاز توسعه غیرفعال است</p>
      <div class="grid2">
        <label>نام و نام خانوادگی<input disabled placeholder="نام کامل"></label>
        <label>نقش سازمانی<input disabled placeholder="بازرس، مدیر یا نماینده"></label>
        <label>شماره تماس<input disabled placeholder="شماره تماس"></label>
        <label>ایمیل<input disabled placeholder="name@example.com"></label>
        <label>تصویر مهر<input type="file" accept="image/*" disabled></label>
        <label>تصویر امضا<input type="file" accept="image/*" disabled></label>
      </div>
      <p class="hint">فیلدهای مهر و امضا برای مشاهده در سامانه نگه داشته شده‌اند؛ در حال حاضر هیچ تصویری بارگذاری یا ذخیره نمی‌شود.</p>
    </article>`
  );
}

async function renderRecord() {
  const rows = await api("/api/inspector/record");
  app.innerHTML = shell(
    "کارنامه بازرسی",
    "بازرسی‌هایی که کارفرما تأیید کرده، با زمان، تاریخ، شرکت و بازهٔ انجام کار.",
    `<article class="card pad">${recordTable(rows)}</article>`
  );
}

async function renderPeople() {
  if (state.me.role === "buyer") {
    const records = await api("/api/company/inspections");
    app.innerHTML = shell(
      "بازرسی‌های انجام‌شده توسط این شرکت",
      "سوابق بازرسی پروژه‌های کارفرما و وضعیت تأیید نهایی",
      `<article class="card pad"><div class="tablewrap"><table><thead><tr><th>گزارش</th><th>پروژه</th><th>تجهیز / نقطه</th><th>بازرس</th><th>نتیجه</th><th>تأیید کارفرما</th><th>تاریخ ثبت</th><th></th></tr></thead><tbody>
        ${records.map((row) => `<tr><td>${esc(row.ivr_no)}</td><td>${esc(row.project)}</td><td>${esc(row.tag)} · ${esc(row.title)}</td><td>${esc(row.inspector)}</td><td>${esc(row.result_label)}${row.client_rejection_note ? `<small>${esc(row.client_rejection_note)}</small>` : ""}</td><td>${row.client_approved ? "تأییدشده" : row.client_rejection_note ? "ردشده" : "در انتظار"}</td><td>${esc(faWhen(row.submitted_at).date)}</td><td><button class="ghost" data-act="open-ivr" data-id="${row.visit_id}">مشاهده</button></td></tr>`).join("") || `<tr><td colspan="8">بازرسی انجام‌شده‌ای برای شرکت ثبت نشده است.</td></tr>`}
      </tbody></table></div></article>`
    );
    return;
  }
  const people = await api("/api/inspectors");
  app.innerHTML = shell(
    "بازرسان",
    "تخصص، موقعیت جغرافیایی، آنلاین بودن و شعاع پوشش. پیام جعفری آفلاین است و نیما حسینی در قزوین از شعاع کارگاه بیرون است.",
    `<table><thead><tr><th>نام</th><th>شهر</th><th>مختصات (عرض، طول)</th><th>وضعیت</th><th>تخصص</th><th>امتیاز</th><th>کار فعال</th></tr></thead><tbody>
      ${people.map((person) => `<tr><td>${esc(person.name)}</td><td>${esc(person.city)}</td><td dir="ltr">${Number(person.lat).toFixed(5)}, ${Number(person.lng).toFixed(5)}</td><td>${person.online ? "آنلاین" : "آفلاین"}</td><td>${esc(person.discipline_labels.join("، "))}</td><td>${person.rating.toLocaleString("fa-IR")}</td><td>${person.active_jobs.toLocaleString("fa-IR")}</td></tr>`).join("")}
    </tbody></table>`
  );
}

async function renderWallet() {
  const ledger = await api("/api/ledger");
  app.innerHTML = shell(
    "تسویه بازدید",
    "هجده درصد سهم سامانه است. بازدید مردود، تا اصلاح و تأیید دوباره، تسویه نمی‌شود.",
    `<div class="kpis">
      <div class="kpi"><span>بازدید تسویه‌شده</span><strong>${ledger.count.toLocaleString("fa-IR")}</strong></div>
      <div class="kpi"><span>ناخالص</span><strong>${money(ledger.fee_irr)}</strong></div>
      <div class="kpi"><span>سهم سامانه</span><strong>${money(ledger.commission_irr)}</strong></div>
      <div class="kpi"><span>خالص بازرس</span><strong>${money(ledger.net_irr)}</strong></div>
    </div>`
  );
}

function mark(code, legend) {
  return `<span class="mark mark-${esc(code)}">${esc(legend[code] || code)}</span>`;
}

function sourceList(sources) {
  return sources.map((source) => {
    const title = source.url.startsWith("http")
      ? `<a href="${esc(source.url)}" target="_blank" rel="noopener">${esc(source.title)}</a>`
      : `<b>${esc(source.title)}</b>`;
    return `<li>${title}<small>${esc(source.used_for)} · ${esc(source.url)}</small></li>`;
  }).join("");
}

async function renderBenchmark() {
  const data = await api("/api/benchmark");
  const head = data.systems.map((system) => `<th>${esc(system.name)}</th>`).join("");
  const rows = data.criteria.map((criterion) => `
    <tr>
      <th>${esc(criterion.label)}</th>
      ${data.systems.map((system) => `<td>${mark(system.scores[criterion.id], data.legend)}</td>`).join("")}
    </tr>`).join("");
  const cards = data.systems.filter((system) => system.id !== "ours").map((system) => `
    <article class="card pad detail">
      <div class="split"><span class="chip">${esc(system.kind)}</span><span class="chip">${esc(system.region)}</span></div>
      <h3>${esc(system.name)}</h3>
      <p>${esc(system.summary)}</p>
      <h3>آنچه منبع می‌گوید</h3>
      <ul>${system.does.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>
      <h3>نزدیک به این نسخه</h3>
      <ul>${system.same.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>
      <h3>جلوتر از این نسخه</h3>
      <ul>${system.ahead_of_us.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>
      <h3>تفاوت این نسخه</h3>
      <ul>${system.we_do.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>
      <h3>منبع</h3>
      <ul class="sources">${sourceList(system.sources)}</ul>
    </article>`).join("");
  const ours = data.systems.find((system) => system.id === "ours");
  app.innerHTML = shell(
    "بنچ‌مارک",
    `مقایسه تا ${data.as_of}. ${data.method}`,
    `<div class="detail">
      <article class="card pad">
        <h3>${esc(ours.name)}</h3>
        <p>${esc(ours.summary)}</p>
        <ul>${ours.does.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>
        <ul>${ours.limits.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>
      </article>
      <div class="tablewrap">
        <table class="matrix">
          <thead><tr><th>معیار</th>${head}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="hint">راهنما: ${Object.entries(data.legend).map(([code, label]) => mark(code, data.legend)).join(" ")}</p>
      ${cards}
      <article class="card pad">
        <h3>${esc(data.institutional.name)}</h3>
        <p>${esc(data.institutional.summary)}</p>
        <ul class="sources">${sourceList(data.institutional.sources)}</ul>
      </article>
    </div>`
  );
}

async function renderTechnology() {
  const data = await api("/api/technology");
  const cards = data.layers.map((layer) => `
    <article class="card pad detail">
      <div class="split">
        <h3>${esc(layer.title)}</h3>
        <span class="chip status-${esc(layer.status)}">${esc(layer.status_label)}</span>
      </div>
      <p>${esc(layer.summary)}</p>
      <table>
        <tbody>
          ${layer.items.map((item) => `<tr><th>${esc(item.name)}</th><td>${esc(item.note)}</td></tr>`).join("")}
        </tbody>
      </table>
    </article>`).join("");
  app.innerHTML = shell(
    "تکنولوژی استفاده‌شده",
    `نسخه ${data.version}. ${data.principle}`,
    `<div class="techgrid">${cards}</div>`
  );
}

async function render() {
  clearTimeout(state.deskTimer);
  if (!state.me) {
    login();
    return;
  }
  if (
    state.me.role === "buyer"
    && ["dispatch", "forms", "benchmark", "technology"].includes(state.view)
    && !(state.view === "forms" && (state.requestPointId || state.inRequestMode))
  ) {
    state.view = "desk";
    state.viewHistory = [];
  }
  if (
    state.me.role === "vendor"
    && !["desk", "docs", "notifications", "point"].includes(state.view)
  ) {
    state.view = "desk";
    state.viewHistory = [];
  }
  const views = {
    desk: renderDesk,
    registration: renderRegistration,
    ivr: () => renderIvr(state.visitId),
    dispatch: renderDispatch,
    archive: renderArchive,
    record: renderRecord,
    docs: renderDocs,
    moms: renderMoms,
    forms: renderForms,
    notifications: renderNotifications,
    people: renderPeople,
    wallet: renderWallet,
    benchmark: renderBenchmark,
    technology: renderTechnology,
    point: renderPoint,
  };
  try {
    await api("/api/dispatch/tick", { method: "POST" });
    await (views[state.view] || renderDesk)();
  } catch (error) {
    app.innerHTML = shell("خطا", "نمایش این صفحه ممکن نشد.", `<article class="card pad">${esc(error.message)}</article>`);
  }
}

async function onClick(event) {
  const requestPanelSummary = event.target.closest(".buyer-request-box > summary");
  if (requestPanelSummary) {
    const panels = [...app.querySelectorAll(".buyer-request-box")];
    const index = panels.indexOf(requestPanelSummary.parentElement);
    if (index >= 0) state.buyerRequestPanels[index] = !panels[index].open;
    return;
  }
  const node = event.target.closest("[data-act]");
  if (!node) return;
  const act = node.dataset.act;
  try {
    if (act === "login") {
      state.me = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: node.dataset.user, password: "demo1234" }) });
      state.viewHistory = [];
      state.view = state.me.role === "inspector" ? "dispatch" : "desk";
      await render();
    } else if (act === "logout") {
      await api("/api/auth/logout", { method: "POST" });
      state.me = null;
      state.viewHistory = [];
      render();
    } else if (act === "back") {
      goBack();
      await render();
    } else if (act === "open-form") {
      state.formReturnView = state.view === "forms" ? state.formReturnView : state.view;
      state.inRequestMode = false;
      state.formKind = node.dataset.kind || "itp";
      state.formId = null;
      state.formDraft = null;
      state.requestPointId = null;
      state.requestPrefill = null;
      navigateTo("forms");
      await render();
    } else if (act === "form-kind") {
      state.formKind = node.dataset.kind;
      state.formId = null;
      state.formDraft = null;
      navigateTo("forms");
      await render();
    } else if (act === "new-form") {
      state.formId = null;
      state.formDraft = null;
      await render();
    } else if (act === "open-sheet") {
      state.formReturnView = state.view === "forms" ? state.formReturnView : state.view;
      state.inRequestMode = false;
      state.formId = Number(node.dataset.id);
      state.formKind = node.dataset.kind || state.formKind;
      state.formDraft = null;
      state.requestPointId = null;
      state.requestPrefill = null;
      navigateTo("forms");
      await render();
    } else if (act === "begin-in-request") {
      state.formReturnView = state.view;
      state.inRequestMode = true;
      state.formKind = "in";
      state.formId = null;
      state.formDraft = null;
      const requestBoard = await api(`/api/board?kind=${state.kind === "case" ? "case" : "project"}`);
      const firstEligiblePoint = requestBoard.find((row) =>
        ["draft", "documents_missing", "returned"].includes(row.request_status)
      );
      if (!firstEligiblePoint) throw new Error("نقطه‌ای برای ثبت درخواست IN موجود نیست.");
      state.pointId = Number(firstEligiblePoint.id);
      const detail = await api(`/api/points/${state.pointId}`);
      state.requestPointId = state.pointId;
      state.requestPrefill = prefillInspectionRequest(detail);
      navigateTo("forms");
      await render();
    } else if (act === "open-request-form") {
      state.formReturnView = state.view === "forms" ? state.formReturnView : state.view;
      state.pointId = Number(node.dataset.id);
      const detail = await api(`/api/points/${state.pointId}`);
      state.inRequestMode = true;
      state.requestPointId = state.pointId;
      state.requestPrefill = prefillInspectionRequest(detail);
      state.formKind = "in";
      state.formId = null;
      state.formDraft = null;
      navigateTo("forms");
      await render();
    } else if (act === "select-in-point") {
      if (state.requestPointId) {
        state.formDraft = collectForm();
        ["client", "project", "po", "contractor", "vendor", "manufacturer", "location", "tag", "itp_item", "discipline", "reference"].forEach((key) => {
          delete state.formDraft[key];
        });
      }
      state.pointId = Number(node.dataset.id);
      const detail = await api(`/api/points/${state.pointId}`);
      state.inRequestMode = true;
      state.requestPointId = state.pointId;
      state.requestPrefill = prefillInspectionRequest(detail);
      state.formKind = "in";
      state.formId = null;
      navigateTo("forms");
      await render();
    } else if (act === "approve-request-manager") {
      const unitManagerId = Number(document.querySelector("#request-unit-manager")?.value);
      if (!unitManagerId) throw new Error("مدیر واحد را انتخاب کنید.");
      const signature = document.querySelector("#request-manager-signature")?.files[0];
      if (!signature) throw new Error("تصویر مهر و امضای مدیر پروژه را بارگذاری کنید.");
      const form = new FormData();
      form.append("unit_manager_id", String(unitManagerId));
      form.append("department", document.querySelector("#request-department")?.value || "");
      form.append("note", document.querySelector("#request-manager-note")?.value || "");
      form.append("file", signature);
      const result = await api(`/api/points/${node.dataset.id}/manager-approval`, {
        method: "POST",
        body: form,
      });
      toast(result.request_status === "documents_missing" ? result.message : "درخواست برای مدیر واحد ارسال شد");
      await render();
    } else if (act === "approve-request-unit") {
      const signature = document.querySelector(`#request-unit-signature-${node.dataset.id}`)?.files[0];
      if (!signature) throw new Error("تصویر مهر و امضای مدیر واحد را بارگذاری کنید.");
      const form = new FormData();
      form.append("note", "");
      form.append("file", signature);
      const result = await api(`/api/points/${node.dataset.id}/unit-approval`, {
        method: "POST",
        body: form,
      });
      toast(result.request_status === "approved_no_inspector" ? result.message : `${result.offers} پیشنهاد برای بازرسان نزدیک ارسال شد`);
      await render();
    } else if (act === "return-request") {
      const reasonInput = document.querySelector("#request-return-reason");
      const reason = reasonInput?.value || window.prompt("دلیل مرجوعی را وارد کنید:") || "";
      if (reason.trim().length < 3) throw new Error("دلیل مرجوعی حداقل باید ۳ نویسه باشد.");
      const result = await api(`/api/points/${node.dataset.id}/return`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      toast(`درخواست به مرحله قبل برگشت: ${result.request_status}`);
      await render();
    } else if (act === "send-request-comment") {
      const body = document.querySelector("#request-comment-body")?.value || "";
      await api(`/api/points/${node.dataset.id}/request-comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      toast("نظر به گفتگو اضافه شد");
      await renderPoint();
    } else if (act === "manager-tab") {
      state.managerTab = node.dataset.tab;
      await render();
    } else if (act === "approve-request-executive") {
      const result = await api(`/api/points/${node.dataset.id}/executive-approval`, {
        method: "POST",
        body: JSON.stringify({ note: "" }),
      });
      toast(result.request_status === "approved_no_inspector" ? result.message : `${result.offers} پیشنهاد برای بازرسان نزدیک ارسال شد`);
      await render();
    } else if (act === "send-comment") {
      const visitId = Number(node.dataset.id);
      const body = document.querySelector("#report-comment").value;
      await api(`/api/visits/${visitId}/comments`, { method: "POST", body: JSON.stringify({ body }) });
      toast("نظر به اعضای کارتابل گزارش ارسال شد");
      await renderIvr(visitId);
    } else if (act === "upload-visit-attachment") {
      const file = document.querySelector("#visit-attachment").files[0];
      if (!file) throw new Error("ابتدا فایل را انتخاب کنید.");
      const form = new FormData();
      form.append("file", file);
      form.append("kind", "item");
      form.append("caption", file.name);
      await api(`/api/visits/${node.dataset.id}/attachments`, { method: "POST", body: form });
      toast("پیوست گزارش بارگذاری شد");
      await renderIvr(Number(node.dataset.id));
    } else if (act === "print-form") {
      window.print();
    } else if (act === "save-form") {
      const payload = collectForm();
      if (state.requestPointId) {
        const result = await api(`/api/points/${state.requestPointId}/request`, {
          method: "POST",
          body: JSON.stringify({
            in_payload: payload,
            remote_requested: Boolean(document.querySelector("#request-remote")?.checked),
            note: payload.observation || "",
          }),
        });
        state.pointId = state.requestPointId;
        state.requestPointId = null;
        state.inRequestMode = false;
        state.requestPrefill = null;
        state.formDraft = null;
        state.view = "point";
        toast(result.request_status === "documents_missing" ? result.message : "درخواست IN برای مدیر پروژه ارسال شد");
        await render();
      } else {
        const saved = await api("/api/forms", {
          method: "POST",
          body: JSON.stringify({ kind: state.formKind, sheet_id: state.formId, payload }),
        });
        state.formId = saved.id;
        state.formDraft = null;
        toast("فرم ثبت شد");
        await render();
      }
    } else if (act === "kind") {
      state.kind = node.dataset.kind === "case" ? "case" : "project";
      navigateTo("desk");
      await render();
    } else if (act === "goto") {
      if (node.dataset.view === "forms" && state.view !== "forms") state.formReturnView = state.view;
      navigateTo(node.dataset.view);
      await render();
    } else if (act === "open-point") {
      state.pointId = node.dataset.id;
      navigateTo("point");
      await render();
    } else if (act === "open-ivr") {
      state.visitId = Number(node.dataset.id);
      navigateTo("ivr");
      await render();
    } else if (act === "print-archive") {
      window.print();
    } else if (act === "upload-document") {
      const file = document.querySelector("#document-file").files[0];
      if (!file) throw new Error("ابتدا فایل مدرک را انتخاب کنید.");
      const body = new FormData();
      body.append("equipment_id", document.querySelector("#document-equipment").value);
      body.append("doc_type", document.querySelector("#document-type").value);
      body.append("file", file);
      await api("/api/documents/upload", { method: "POST", body });
      toast("فایل مدرک بارگذاری و ثبت شد");
      await render();
    } else if (act === "ready") {
      await api(`/api/points/${node.dataset.id}/ready`, { method: "POST", body: JSON.stringify({ remote_requested: node.dataset.remote === "1", window_note: "اعلام از میز سازنده" }) });
      toast("آمادگی ثبت شد");
      await render();
    } else if (act === "broadcast") {
      await api(`/api/points/${node.dataset.id}/broadcast`, { method: "POST" });
      toast("پیشنهاد برای بازرسان نزدیک ارسال شد");
      await render();
    } else if (act === "accept") {
      await api(`/api/offers/${node.dataset.id}/accept`, { method: "POST" });
      toast("بازدید برای شما قفل شد");
      await render();
    } else if (act === "decline") {
      await api(`/api/offers/${node.dataset.id}/decline`, { method: "POST" });
      toast("پیشنهاد رد شد");
      await render();
    } else if (act === "enroute") {
      await api(`/api/visits/${node.dataset.id}/en-route`, { method: "POST" });
      await render();
    } else if (act === "remote") {
      await api(`/api/visits/${node.dataset.id}/remote`, { method: "POST" });
      toast("بازبینی شروع شد؛ برای ثبت گزارش، موقعیت را تأیید کنید");
      await render();
    } else if (act === "confirm-location") {
      const location = await currentLocation();
      await api(`/api/visits/${node.dataset.id}/location`, { method: "POST", body: JSON.stringify(location) });
      toast("موقعیت جغرافیایی تأیید شد؛ پیوست گزارش فعال است");
      await render();
    } else if (act === "arrive") {
      const location = await currentLocation();
      await api(`/api/visits/${node.dataset.id}/arrive`, { method: "POST", body: JSON.stringify(location) });
      toast("حضور در محدوده کارگاه ثبت شد");
      await render();
    } else if (act === "submit-visit") {
      const active = await api("/api/visits/active");
      const answers = active.context.point.checklist.map((item) => ({
        item_id: item.id,
        value: state.draft[item.id] || "pass",
        note: (state.draft[item.id] || "pass") === "fail" ? "خارج از معیار پذیرش کارگاهی" : "",
      }));
      await api(`/api/visits/${node.dataset.id}/checklist`, { method: "POST", body: JSON.stringify({ answers }) });
      const note = node.dataset.result === "reject" ? "بازدید مردود شد و نیاز به تعمیر دارد." : "بازدید مطابق ITP قابل قبول است و شواهد پیوست شد.";
      await api(`/api/visits/${node.dataset.id}/submit`, { method: "POST", body: JSON.stringify({ result: node.dataset.result, note }) });
      toast("IVR ارسال شد");
      navigateTo("desk");
      await render();
    } else if (act === "review") {
      let note = document.querySelector(`#review-note-${node.dataset.id}`)?.value || "";
      if (node.dataset.decision === "return" && note.trim().length < 3) {
        note = window.prompt("دلیل مرجوعی گزارش را وارد کنید:") || "";
      }
      if (node.dataset.decision === "return" && note.trim().length < 3) {
        throw new Error("برای مرجوع کردن گزارش، دلیل حداقل سه نویسه‌ای لازم است.");
      }
      const result = await api(`/api/visits/${node.dataset.id}/review`, {
        method: "POST",
        body: JSON.stringify({ decision: node.dataset.decision, note }),
      });
      toast(node.dataset.decision === "return"
        ? (result.visit.report_stage === "inspector_revision" ? "برای اصلاح به بازرس برگشت" : "برای بررسی دوباره به مرحله قبل برگشت")
        : (result.visit.report_stage === "manager_review" ? "تأیید شد و به مدیر پروژه رفت" : "تأیید شد و به کارفرما رفت"));
      await render();
    } else if (act === "confirm-report") {
      await api(`/api/visits/${node.dataset.id}/confirm`, { method: "POST" });
      toast("تأیید نهایی ثبت شد و صورت‌وضعیت و فاکتور برای کارفرما صادر شد");
      await render();
    } else if (act === "client-reject-report") {
      const reason = document.querySelector(`#client-reject-note-${node.dataset.id}`)?.value || "";
      await api(`/api/visits/${node.dataset.id}/client-reject`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      toast("گزارش با دلیل ثبت‌شده رد و برای اصلاح برگشت");
      await render();
    } else if (act === "update-bill-status") {
      const billId = Number(node.dataset.id);
      const status = document.querySelector(`#bill-status-${billId}`).value;
      const note = document.querySelector(`#bill-note-${billId}`).value;
      await api(`/api/bills/${billId}/accounting-status`, {
        method: "POST",
        body: JSON.stringify({ status, note }),
      });
      toast("وضعیت صورت‌وضعیت ثبت شد");
      await render();
    } else if (act === "update-claim-status") {
      const billId = Number(node.dataset.id);
      const status = document.querySelector(`#claim-status-${billId}`).value;
      const note = document.querySelector(`#claim-note-${billId}`).value;
      await api(`/api/bills/${billId}/claim-status`, {
        method: "POST",
        body: JSON.stringify({ status, note }),
      });
      toast("وضعیت Claim ثبت شد");
      await render();
    } else if (act === "save-mom") {
      await api("/api/moms", {
        method: "POST",
        body: JSON.stringify({
          title: document.querySelector("#mom-title").value,
          held_on: document.querySelector("#mom-date").value,
          attendees: document.querySelector("#mom-people").value,
          body: document.querySelector("#mom-body").value,
        }),
      });
      toast("صورتجلسه ثبت شد");
      await render();
    }
  } catch (error) {
    toast(error.message);
  }
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || state.view !== "forms") return;
  event.preventDefault();
  goBack();
  render();
});

app.addEventListener("click", onClick);
app.addEventListener("change", async (event) => {
  const formLocation = event.target.closest("[data-form-key='customer_location']");
  if (formLocation) {
    state.formDraft = collectForm();
    await renderForms();
    return;
  }
  const node = event.target.closest("[data-act='answer']");
  if (node) {
    state.draft[node.dataset.item] = node.value;
    return;
  }
  const photo = event.target.closest("[data-act='pick-photo']");
  if (!photo || !photo.files || !photo.files[0]) return;
  const place = await new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 4000 },
    );
  });
  const body = new FormData();
  body.append("kind", photo.dataset.kind);
  body.append("file", photo.files[0]);
  if (place) {
    body.append("lat", String(place.lat));
    body.append("lng", String(place.lng));
  }
  try {
    await api(`/api/visits/${photo.dataset.id}/photo`, { method: "POST", body });
    toast("عکس روی موبایل ثبت شد");
  } catch (error) {
    toast(error.message);
  }
});

boot();
