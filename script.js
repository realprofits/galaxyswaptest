function sanitizeDecimalInput(s) {
    // keep digits + one dot, max 10 decimals
    s = String(s ?? "");
    s = s.replace(/[^\d.]/g, "");         // remove non-numeric except dot
    const parts = s.split(".");
    if (parts.length > 2) s = parts[0] + "." + parts.slice(1).join(""); // only one dot
    const [a, b] = s.split(".");
    if (b && b.length > 10) s = a + "." + b.slice(0, 10);
    return s;
}

function enforceNumericInput(inputEl) {
    // block letters on keypress
    inputEl.addEventListener("beforeinput", (e) => {
        // allow deletion etc.
        if (!e.data) return;
        if (!/[\d.]/.test(e.data)) e.preventDefault();
    });

    // sanitize on input (paste, drag-drop, etc)
    inputEl.addEventListener("input", () => {
        const cleaned = sanitizeDecimalInput(inputEl.value);
        if (cleaned !== inputEl.value) inputEl.value = cleaned;
    });

    // prevent non-numeric paste entirely (still sanitized as backup)
    inputEl.addEventListener("paste", (e) => {
        const text = (e.clipboardData || window.clipboardData).getData("text");
        if (!/^[\d.\s]+$/.test(text)) e.preventDefault();
    });
}


// ===== Coins list (CoinGecko ids + symbols + icon URLs) =====
const COINS = [
    { id: "bitcoin", symbol: "BTC", name: "Bitcoin", icon: "https://assets.coincap.io/assets/icons/btc@2x.png" },
    { id: "ethereum", symbol: "ETH", name: "Ethereum", icon: "https://assets.coincap.io/assets/icons/eth@2x.png" },
    { id: "tether", symbol: "USDT", name: "Tether", icon: "https://assets.coincap.io/assets/icons/usdt@2x.png" },
    { id: "solana", symbol: "SOL", name: "Solana", icon: "https://assets.coincap.io/assets/icons/sol@2x.png" },
    { id: "binancecoin", symbol: "BNB", name: "BNB", icon: "https://assets.coincap.io/assets/icons/bnb@2x.png" },
    { id: "litecoin", symbol: "LTC", name: "Litecoin", icon: "https://assets.coincap.io/assets/icons/ltc@2x.png" },
    { id: "ripple", symbol: "XRP", name: "XRP", icon: "https://assets.coincap.io/assets/icons/xrp@2x.png" },
];

// Fallback prices in USD only; if fiat != usd and fetch fails, we still show USD-ish values.
const FALLBACK_USD = {
    bitcoin: 65000,
    ethereum: 3500,
    tether: 1,
    solana: 150,
    binancecoin: 600,
    litecoin: 80,
    ripple: 0.6
};

let prices = { ...FALLBACK_USD };
let fiat = "usd";            // selected fiat currency
let priceStatus = "loading"; // loading | live | fallback

const feePct = 0.015; // 1.5%

/**
 * Fixed deposit destinations (placeholders).
 * Replace addresses with your real deposit addresses for each coin/network.
 */
const DEPOSIT_DESTINATIONS = {
    BTC: { address: "bc1q2wkwch92nlujwxukxl75fc09v8vpund7tt0x6m", network: "Bitcoin", uriPrefix: "bitcoin:" },
    ETH: { address: "0xA95E319822BF711d86eEb75D7f65E9F62c677BA7", network: "Ethereum", uriPrefix: "ethereum:" },
    USDT: { address: "0xA95E319822BF711d86eEb75D7f65E9F62c677BA7", network: "USDT (ERC20)", uriPrefix: "ethereum:" },
    SOL: { address: "8faQ3R8Pn4zL5t5zJDbAdm9nCDAMXMHWv6a8nkJkE9Gv", network: "Solana", uriPrefix: "solana:" },
    BNB: { address: "0xA95E319822BF711d86eEb75D7f65E9F62c677BA7", network: "BNB Smart Chain", uriPrefix: "ethereum:" },
    LTC: { address: "La3Fi2KR38pV4hpRJCE7HoSaBavfnvMHga", network: "Litecoin", uriPrefix: "litecoin:" },
    XRP: { address: "rphA5Jzq9nmSzG1mr2jJFpH1VjFUfwC5py", network: "XRP", uriPrefix: "xrp:" },
};

function getDepositInfo(symbol) {
    return DEPOSIT_DESTINATIONS[symbol] || { address: "DEPOSIT_ADDRESS_PLACEHOLDER", network: "Network", uriPrefix: "" };
}

// ===== Toast notifications =====
function showToast(type, title, message, ms = 3200) {
    const host = document.getElementById("toastHost");
    if (!host) return;

    const el = document.createElement("div");
    el.className = `toast ${type || "info"}`;
    el.innerHTML = `<div class="t-title"></div><div class="t-msg"></div>`;
    el.querySelector(".t-title").textContent = title || "Notice";
    el.querySelector(".t-msg").textContent = message || "";
    host.appendChild(el);

    // animate in
    requestAnimationFrame(() => el.classList.add("show"));

    // remove later
    window.setTimeout(() => {
        el.classList.remove("show");
        window.setTimeout(() => el.remove(), 220);
    }, ms);
}

function setFieldErrorToast(label) {
    showToast("error", "Invalid details", label);
}

function $(id) { return document.getElementById(id); }

function parseNum(v) {
    const s = String(v ?? "").trim();
    if (s === "") return 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
}

function fmtFiat(n) {
    if (!Number.isFinite(n)) return "—";
    const curr = fiat.toUpperCase();
    // Simple symbol mapping (optional)
    const sym = curr === "USD" ? "$" : curr === "EUR" ? "€" : curr === "GBP" ? "£" : "";
    return `${sym}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${sym ? "" : curr}`.trim();
}

function fmtCoin(n) {
    if (!Number.isFinite(n)) return "—";
    const abs = Math.abs(n);
    const max = abs >= 1 ? 6 : 10;
    return n.toLocaleString(undefined, { maximumFractionDigits: max });
}

// ===== Custom Dropdown =====
function createDropdown(mountEl, initialCoin, onChange) {
    let selected = initialCoin;
    let query = "";
    let open = false;

    mountEl.classList.add("dd");
    mountEl.innerHTML = `
    <button class="dd-btn" type="button">
      <span class="dd-left">
        <img class="coin-ic" alt="" />
        <span class="dd-title"></span>
      </span>
      <span class="dd-caret">▾</span>
    </button>

    <div class="dd-menu" role="listbox">
      <div class="dd-search">
        <input type="text" placeholder="Search coin…" />
      </div>
      <div class="dd-list"></div>
    </div>
  `;

    const btn = mountEl.querySelector(".dd-btn");
    const img = mountEl.querySelector(".coin-ic");
    const title = mountEl.querySelector(".dd-title");
    const search = mountEl.querySelector(".dd-search input");
    const list = mountEl.querySelector(".dd-list");

    function setSelected(c) {
        selected = c;
        img.src = c.icon;
        img.onerror = () => img.removeAttribute("src");
        title.textContent = `${c.name} (${c.symbol})`;
        onChange(c);
    }

    function render() {
        const q = query.trim().toLowerCase();
        const filtered = !q ? COINS : COINS.filter(c =>
            c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q)
        );

        list.innerHTML = filtered.map(c => `
      <button class="dd-item" type="button" data-id="${c.id}">
        <img class="coin-ic" alt="" src="${c.icon}" onerror="this.removeAttribute('src')" />
        <span class="coin-meta">
          <span class="coin-name">${c.name}</span>
          <span class="coin-sym">${c.symbol}</span>
        </span>
      </button>
    `).join("");

        list.querySelectorAll(".dd-item").forEach(item => {
            item.addEventListener("click", () => {
                const id = item.getAttribute("data-id");
                const c = COINS.find(x => x.id === id);
                if (c) {
                    setSelected(c);
                    close();
                    search.value = "";
                    query = "";
                    render();
                }
            });
        });
    }

    function openMenu() {
        open = true;
        mountEl.classList.add("open");
        search.focus();
    }

    function close() {
        open = false;
        mountEl.classList.remove("open");
    }

    btn.addEventListener("click", () => {
        open ? close() : openMenu();
    });

    search.addEventListener("input", (e) => {
        query = e.target.value || "";
        render();
    });

    document.addEventListener("mousedown", (e) => {
        if (!mountEl.contains(e.target)) close();
    });

    render();
    setSelected(selected);

    return {
        get value() { return selected; },
        set value(c) { setSelected(c); }
    };
}

// ===== Prices (CoinGecko) =====
async function fetchPrices() {
    try {
        priceStatus = "loading";
        $("priceStatus").textContent = "Loading prices…";

        const ids = COINS.map(c => c.id).join(",");
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=${encodeURIComponent(fiat)}`;

        const res = await fetch(url, { headers: { "accept": "application/json" } });
        if (!res.ok) throw new Error("HTTP " + res.status);

        const json = await res.json();
        const next = {};

        for (const c of COINS) {
            const v = json?.[c.id]?.[fiat];
            if (typeof v === "number" && Number.isFinite(v) && v > 0) next[c.id] = v;
        }

        // If we didn't get most prices, consider it a failure
        const got = Object.keys(next).length;
        if (got < Math.max(2, COINS.length - 2)) throw new Error("Too few prices");

        prices = next;
        priceStatus = "live";
        $("priceStatus").textContent = `Live pricing (${fiat.toUpperCase()})`;
    } catch (err) {
        // fallback to USD fallback values, but label as fallback
        prices = { ...FALLBACK_USD };
        priceStatus = "fallback";
        $("priceStatus").textContent = "Offline pricing (fallback)";
    }

    updateSwap();
}

// ===== Swap logic =====
let fromDD, toDD;

function updateSwap() {
    // Safety: if dropdowns not ready, bail.
    if (!fromDD || !toDD) return;

    const fromCoin = fromDD.value;
    const toCoin = toDD.value;

    const fromPrice = prices[fromCoin.id] || 0;
    const toPrice = prices[toCoin.id] || 0;

    const amt = parseNum($("fromAmount").value);
    const fiatValue = amt * fromPrice;

    const grossOut = (toPrice > 0) ? (fiatValue / toPrice) : 0;
    const netOut = grossOut * (1 - feePct);

    $("toAmount").value = netOut > 0 ? fmtCoin(netOut) : "";

    // Fiat display
    $("fromFiat").textContent = fiatValue > 0 ? fmtFiat(fiatValue) : "—";
    $("toFiat").textContent = (netOut > 0 && toPrice > 0) ? fmtFiat(netOut * toPrice) : "—";

    // Price lines
    $("fromPriceLine").textContent = `1 ${fromCoin.symbol} ≈ ${fmtFiat(fromPrice)}`;
    $("toPriceLine").textContent = `1 ${toCoin.symbol} ≈ ${fmtFiat(toPrice)}`;
    $("feePct").textContent = `${(feePct * 100).toFixed(2)}%`;

    // Enable exchange
    const receiveOk = $("receiveAddr").value.trim().length >= 8;
    const refundOk = $("refundAddr").value.trim().length >= 8;
    const amtOk = amt > 0 && fromCoin.id !== toCoin.id;
    $("swapBtn").disabled = !(receiveOk && refundOk && amtOk);
}

function flipSwap() {
    const a = fromDD.value;
    const b = toDD.value;
    fromDD.value = b;
    toDD.value = a;
    updateSwap();
}

// ===== FAQ (robust) =====
function initFaq() {
    const faqList = $("faqList");
    if (!faqList) return;

    faqList.addEventListener("click", (e) => {
        const btn = e.target.closest(".faq-q");
        if (!btn) return;

        const item = btn.closest(".faq-item");
        if (!item) return;

        const isOpen = item.classList.toggle("open");
        btn.setAttribute("aria-expanded", String(isOpen));
    });
}

// ===== Smooth scroll =====
function initScroll() {
    document.querySelectorAll("[data-scroll]").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = btn.getAttribute("data-scroll");
            const el = document.getElementById(id);
            if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    });
}

// ===== Init =====
window.addEventListener("DOMContentLoaded", async () => {
    $("year").textContent = String(new Date().getFullYear());
    enforceNumericInput($("fromAmount"));
    const tw = $("typewriter");
    if (tw) {
        // Type only the dynamic word(s) after the static "Swap" in the hero title.
        startTypewriter(tw, ["without KYC", "instantly", "with privacy"]);
    }

    // ===== Track Orders panel =====
    const trackBtn = document.getElementById("trackBtn");
    const trackPanel = document.getElementById("trackPanel");
    const trackBackdrop = document.getElementById("trackBackdrop");
    const trackCloseBtn = document.getElementById("trackCloseBtn");
    const trackSearchBtn = document.getElementById("trackSearchBtn");
    const trackInput = document.getElementById("trackInput");
    const trackResult = document.getElementById("trackResult");

    function openTrack() {
        trackBackdrop.hidden = false;
        trackPanel.classList.add("open");
        trackPanel.setAttribute("aria-hidden", "false");
        // small timeout so transition is smooth before focusing
        setTimeout(() => trackInput?.focus(), 50);
    }

    function closeTrack() {
        trackPanel.classList.remove("open");
        trackPanel.setAttribute("aria-hidden", "true");
        // wait for slide transition then hide backdrop
        setTimeout(() => { trackBackdrop.hidden = true; }, 220);
    }

    trackBtn?.addEventListener("click", openTrack);
    trackCloseBtn?.addEventListener("click", closeTrack);
    trackBackdrop?.addEventListener("click", closeTrack);

    // ESC to close
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && trackPanel.classList.contains("open")) closeTrack();
    });

    // Simple “real-ish” checks for now (we’ll refine later)
    // - Order IDs: allow letters/numbers/_- and length 10–64
    // - Tx hashes: 0x + 64 hex (ETH-style)
    function looksLikeOrderIdOrTxHash(s) {
        if (!s) return false;

        // ETH-style tx hash
        if (/^0x[a-fA-F0-9]{64}$/.test(s)) return true;

        // Generic order id: 10-64 of A-Z a-z 0-9 _ -
        if (/^[A-Za-z0-9_-]{10,64}$/.test(s)) return true;

        return false;
    }

    trackSearchBtn?.addEventListener("click", () => {
        const q = (trackInput?.value || "").trim();

        // If empty: don't call it invalid, just prompt
        if (!q) {
            trackResult.innerHTML = `<div class="track-empty">Enter an Order ID or TXID Hash to track.</div>`;
            return;
        }

        // If it doesn't look real-ish: show invalid (for now)
        if (!looksLikeOrderIdOrTxHash(q)) {
            trackResult.innerHTML = `
      <div style="color: rgba(255,255,255,.9); font-weight: 900;">Invalid reference</div>
      <div style="margin-top:6px; color: rgba(255,255,255,.6);">
        Please check your Order ID / TXID Hash and try again.
      </div>
    `;
            return;
        }

        // If it looks valid: show placeholder “found / pending” for now
        trackResult.innerHTML = `
    <div><b>Status:</b> Pending</div>
    <div><b>Reference:</b> ${q}</div>
    <div><b>Updated:</b> ${new Date().toLocaleString()}</div>
    <div style="margin-top:8px; color: rgba(255,255,255,.55);">
      We’ll connect this to real tracking later.
    </div>
  `;
    });



    // Dropdowns
    fromDD = createDropdown($("fromDD"), COINS[0], updateSwap);
    toDD = createDropdown($("toDD"), COINS[1], updateSwap);

    // Inputs
    $("fromAmount").addEventListener("input", updateSwap);
    $("receiveAddr").addEventListener("input", updateSwap);
    $("refundAddr").addEventListener("input", updateSwap);

    $("swapFlipBtn").addEventListener("click", flipSwap);

    // Fiat selector
    $("fiatSelect").addEventListener("change", async (e) => {
        fiat = e.target.value;
        await fetchPrices();
    });

    $("swapBtn").addEventListener("click", () => {
        const fromCoin = fromDD.value;
        const toCoin = toDD.value;

        const amt = parseNum($("fromAmount").value);
        const receive = $("receiveAddr").value.trim();
        const refund = $("refundAddr").value.trim();

        if (!isValidAmount(amt)) {
            setFieldErrorToast("Enter a valid amount greater than 0.");
            return;
        }

        // Receiving address should match the TO coin network (where user receives)
        if (!validateAddressForCoin(toCoin.symbol, receive)) {
            setFieldErrorToast(`Receiving address doesn't look valid for ${toCoin.symbol}.`);
            return;
        }

        // Refund address should match the FROM coin network (refund comes back in FROM coin)
        if (!validateAddressForCoin(fromCoin.symbol, refund)) {
            setFieldErrorToast(`Refund address doesn't look valid for ${fromCoin.symbol}.`);
            return;
        }

        const dep = getDepositInfo(fromCoin.symbol);

        const fromPrice = prices[fromCoin.id] || 0;
        const fiatValue = amt * fromPrice;

        // Receive values (already calculated on UI)
        const receiveAmt = parseNum($("toAmount").value);
        const receiveFiatText = $("toFiat").textContent || "—";

        // QR data: use a simple URI-like string (provider/backend can replace later)
        const qrData = `${dep.uriPrefix}${dep.address}?amount=${amt}`;

        const payload = {
            fromCoin,
            toCoin,

            // send
            amount: amt,
            amountText: fmtCoin(amt),
            fiatText: fiatValue > 0 ? fmtFiat(fiatValue) : "—",

            // receive (NEW)
            receiveAmount: receiveAmt,
            receiveAmountText: receiveAmt > 0 ? fmtCoin(receiveAmt) : "—",
            receiveFiatText: receiveFiatText,

            // invoice details
            network: dep.network,
            depositAddress: dep.address,
            qrData
        };

        openExchangeModal(payload);
        showToast("info", "Status", "Waiting for payment…");
    });


    initExchangeModal();

    initFaq();
    initScroll();

    // Load prices + refresh
    await fetchPrices();
    setInterval(fetchPrices, 45000);
});

function startTypewriter(el, phrases, opts = {}) {
    const typeSpeed = opts.typeSpeed ?? 75;
    const deleteSpeed = opts.deleteSpeed ?? 45;
    const holdMs = opts.holdMs ?? 1200;
    const gapMs = opts.gapMs ?? 400;

    let i = 0;      // phrase index
    let j = 0;      // char index
    let deleting = false;

    function tick() {
        const phrase = phrases[i];

        if (!deleting) {
            j++;
            el.textContent = phrase.slice(0, j);

            if (j >= phrase.length) {
                setTimeout(() => { deleting = true; tick(); }, holdMs);
                return;
            }
            setTimeout(tick, typeSpeed);
        } else {
            j--;
            el.textContent = phrase.slice(0, j);

            if (j <= 0) {
                deleting = false;
                i = (i + 1) % phrases.length;
                setTimeout(tick, gapMs);
                return;
            }
            setTimeout(tick, deleteSpeed);
        }
    }

    tick();
}

function isValidAmount(n) {
    return Number.isFinite(n) && n > 0 && n < 1e9; // simple sanity cap
}

// Basic address checks by coin (not perfect, but good frontend validation)
function validateAddressForCoin(coinSymbol, address) {
    const a = (address || "").trim();

    if (coinSymbol === "BTC") {
        // Legacy (1...), P2SH (3...), Bech32 (bc1...)
        return /^(bc1)[0-9a-z]{25,87}$/.test(a) || /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(a);
    }

    if (coinSymbol === "ETH") {
        // 0x + 40 hex
        return /^0x[a-fA-F0-9]{40}$/.test(a);
    }

    if (coinSymbol === "USDT") {
        // USDT can be multiple networks; default to Ethereum format for now
        // (We’ll expand to TRC20 etc later)
        return /^0x[a-fA-F0-9]{40}$/.test(a);
    }

    if (coinSymbol === "SOL") {
        // Base58 length typical 32–44
        return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
    }

    if (coinSymbol === "BNB") {
        // BSC is 0x..., (Binance Chain bech32 bnb...) – allow both
        return /^0x[a-fA-F0-9]{40}$/.test(a) || /^bnb1[0-9a-z]{38}$/.test(a);
    }


    if (coinSymbol === "LTC") {
        // Litecoin: bech32 ltc1... or legacy base58 (L/M/3...)
        return /^ltc1[0-9a-z]{25,87}$/.test(a) || /^[LM3][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(a);
    }

    if (coinSymbol === "XRP") {
        // XRP Ledger classic address (starts with r)
        return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(a);
    }

    // Generic fallback: at least something long-ish
    return a.length >= 20;
}


// ===== Exchange Modal helpers =====
let __ex = null;

function initExchangeModal() {
    const exBackdrop = document.getElementById("exBackdrop");
    const exModal = document.getElementById("exModal");
    const exCloseBtn = document.getElementById("exCloseBtn");

    const exSendCrypto = document.getElementById("exSendCrypto");
    const exSendFiat = document.getElementById("exSendFiat");

    // NEW: receiving fields (must exist in your HTML)
    const exReceiveCrypto = document.getElementById("exReceiveCrypto");
    const exReceiveFiat = document.getElementById("exReceiveFiat");

    const exDepositAddress = document.getElementById("exDepositAddress");
    const exNetwork = document.getElementById("exNetwork");
    const exWarnCoin = document.getElementById("exWarnCoin");
    const exStatus = document.getElementById("exStatus");
    const exQrImg = document.getElementById("exQrImg");
    const exQrFallback = document.getElementById("exQrFallback");

    const exCopyAddrBtn = document.getElementById("exCopyAddrBtn");
    const exCopyAmountBtn = document.getElementById("exCopyAmountBtn");
    const exDoneBtn = document.getElementById("exDoneBtn");

    function openExchangeModal(payload) {
        // payload: { fromCoin, amountText, fiatText, receiveAmountText, receiveFiatText, network, depositAddress, qrData }
        if (!exModal || !exBackdrop) return;

        // You send
        if (exSendCrypto) exSendCrypto.textContent = `${payload.amountText} ${payload.fromCoin.symbol}`;
        if (exSendFiat) exSendFiat.textContent = payload.fiatText || "—";

        // You receive (NEW)
        if (exReceiveCrypto && payload.toCoin) {
            const recvText = payload.receiveAmountText || "—";
            exReceiveCrypto.textContent = `${recvText} ${payload.toCoin.symbol}`;
        }
        if (exReceiveFiat) exReceiveFiat.textContent = payload.receiveFiatText || "—";

        if (exDepositAddress) exDepositAddress.textContent = payload.depositAddress || "DEPOSIT_ADDRESS_PLACEHOLDER";
        if (exNetwork) exNetwork.textContent = payload.network || "—";
        if (exWarnCoin) exWarnCoin.textContent = payload.fromCoin.symbol;
        if (exStatus) exStatus.textContent = "waiting for payment";

        // QR image (external generator)
        if (exQrImg && payload.qrData) {
            const size = 260;
            const src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(payload.qrData)}`;
            exQrImg.src = src;
            exQrImg.style.display = "block";
            if (exQrFallback) exQrFallback.style.display = "none";
            exQrImg.onerror = () => {
                exQrImg.style.display = "none";
                if (exQrFallback) exQrFallback.style.display = "grid";
            };
        }

        exBackdrop.hidden = false;
        exModal.classList.add("open");
        exModal.setAttribute("aria-hidden", "false");
    }

    function closeExchangeModal() {
        if (!exModal || !exBackdrop) return;
        exModal.classList.remove("open");
        exModal.setAttribute("aria-hidden", "true");
        setTimeout(() => { exBackdrop.hidden = true; }, 180);
    }

    exCloseBtn?.addEventListener("click", closeExchangeModal);
    exBackdrop?.addEventListener("click", closeExchangeModal);

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && exModal?.classList.contains("open")) closeExchangeModal();
    });

    exCopyAddrBtn?.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText((exDepositAddress?.textContent || "").trim());
            showToast("success", "Copied", "Deposit address copied to clipboard.");
        } catch {
            showToast("error", "Copy failed", "Your browser blocked clipboard access.");
        }
    });

    exCopyAmountBtn?.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText((exSendCrypto?.textContent || "").trim());
            showToast("success", "Copied", "Amount copied to clipboard.");
        } catch {
            showToast("error", "Copy failed", "Your browser blocked clipboard access.");
        }
    });

    exDoneBtn?.addEventListener("click", () => {
        showToast("info", "Waiting for confirmations", "Please wait for the invoice to reach the 'confirming' stage. An invoice ID will be generated shortly.");
    });

    __ex = { openExchangeModal, closeExchangeModal };
}

function openExchangeModal(payload) {
    // compatibility wrapper
    if (__ex?.openExchangeModal) __ex.openExchangeModal(payload);
}
