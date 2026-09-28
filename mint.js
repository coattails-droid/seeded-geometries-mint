// Seeded Geometries — mint page logic.
//
// Dependency-free: talks to the wallet with raw window.ethereum JSON-RPC.
// No libraries, no build step — the whole page is these three files.

(function () {
  "use strict";

  var cfg = (typeof CONFIG !== "undefined") ? CONFIG : null;

  // ---------- tiny DOM helpers ----------
  function $(id) { return document.getElementById(id); }
  function setStatus(kind, html) {
    var el = $("status");
    el.className = kind || "";
    el.innerHTML = html || "";
  }

  // ---------- pure helpers (unit-testable in node) ----------
  // Shorten an address for display: 0x1234…abcd
  function shortAddress(addr) {
    if (typeof addr !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(addr)) return addr;
    return addr.slice(0, 6) + "…" + addr.slice(-4);
  }

  // Parse an eth_call uint256 hex result to a Number (safe for our ranges).
  function parseUint256(hex) {
    if (typeof hex !== "string" || !/^0x[0-9a-fA-F]+$/.test(hex)) {
      throw new Error("bad uint256 result: " + hex);
    }
    return parseInt(hex, 16);
  }

  // Compare two hex wei values numerically. eth_call returns 32-byte
  // zero-padded results, so a raw string compare against the compact
  // config hex would always report a mismatch. BigInt handles both.
  function weiEquals(a, b) {
    if (typeof a !== "string" || typeof b !== "string") return false;
    try { return BigInt(a) === BigInt(b); }
    catch (e) { return false; }
  }

  // Build the eth_sendTransaction params for mint().
  function buildMintTx(from, contractAddress, valueWeiHex) {
    return {
      from: from,
      to: contractAddress,
      data: cfg.SELECTORS.mint, // mint() takes no arguments
      value: valueWeiHex,        // exact price; contract reverts anything else
    };
  }

  // Map common wallet/provider errors to human text.
  function friendlyError(err) {
    var msg = (err && (err.message || err.reason || err)) || "";
    msg = String(msg);
    if (/user rejected|user denied|request rejected/i.test(msg)) return "Transaction rejected in wallet.";
    if (/insufficient funds/i.test(msg)) return "Insufficient ETH for price + gas.";
    if (/sale/i.test(msg) && /not active|closed/i.test(msg)) return "Sale is not active.";
    if (/sold out|supply/i.test(msg)) return "Collection is sold out.";
    return "Transaction failed: " + msg.slice(0, 160);
  }

  // ---------- provider discovery (EIP-6963 + legacy injection) ----------
  // EIP-6963 wallets announce themselves via window events; window.ethereum
  // stays as a fallback. The provider is resolved lazily at connect time —
  // never just once at page load — so late injection still works.
  var announcedProviders = []; // entries: { info: {uuid, name, rdns}, provider }

  function handleAnnounce(event) {
    var detail = event && event.detail;
    if (!detail || !detail.provider || !detail.info || !detail.info.uuid) return;
    var known = announcedProviders.some(function (p) { return p.info.uuid === detail.info.uuid; });
    if (!known) announcedProviders.push(detail);
  }

  function solicitProviders() {
    if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
    try { window.dispatchEvent(new Event("eip6963:requestProvider")); } catch (e) { /* ignore */ }
  }

  // Pure selection logic (unit-testable): prefer MetaMask among announcers,
  // else the first announcer; else the legacy injected provider, preferring
  // MetaMask when several wallets share window.ethereum.
  function selectProvider(announced, injected) {
    var i;
    announced = announced || [];
    for (i = 0; i < announced.length; i++) {
      var rdns = announced[i] && announced[i].info && announced[i].info.rdns;
      if (typeof rdns === "string" && /metamask/i.test(rdns)) return announced[i].provider;
    }
    if (announced.length) return announced[0].provider;
    if (injected) {
      if (injected.providers && injected.providers.length) {
        for (i = 0; i < injected.providers.length; i++) {
          if (injected.providers[i] && injected.providers[i].isMetaMask) return injected.providers[i];
        }
        return injected.providers[0];
      }
      return injected;
    }
    return null;
  }

  function pickProvider() {
    var injected = (typeof window !== "undefined") ? window.ethereum : undefined;
    return selectProvider(announcedProviders, injected || null);
  }

  var provider = null;
  var account = null;

  function onAccountsChanged(accs) {
    account = (accs && accs[0]) || null;
    $("wallet").textContent = account ? shortAddress(account) : "not connected";
    $("wallet").style.color = account ? "#e8e4d8" : "";
    $("connect-wrap").style.display = account ? "none" : "";
    refresh();
  }

  // Resolve (and cache) the provider, wiring wallet events once.
  function ensureProvider() {
    if (!provider) {
      provider = pickProvider();
      if (provider && provider.on && !provider._sgWired) {
        provider._sgWired = true;
        provider.on("accountsChanged", onAccountsChanged);
        provider.on("chainChanged", function () { window.location.reload(); });
      }
    }
    return provider;
  }

  function requireDeployed() {
    return cfg && /^0x[0-9a-fA-F]{40}$/.test(cfg.CONTRACT_ADDRESS) &&
      !/^0x0{40}$/.test(cfg.CONTRACT_ADDRESS);
  }

  async function rpc(method, params) {
    var prov = ensureProvider();
    if (!prov) throw new Error("no wallet provider");
    return prov.request({ method: method, params: params });
  }

  async function ethCall(selector) {
    return rpc("eth_call", [{ to: cfg.CONTRACT_ADDRESS, data: selector }, "latest"]);
  }

  // ---------- refresh on-chain state ----------
  async function refresh() {
    if (!requireDeployed()) {
      $("contract").textContent = "not deployed yet";
      $("sale").textContent = "not deployed";
      setStatus("info", "Contract address not set — check back after deployment.");
      return;
    }
    $("contract").textContent = cfg.CONTRACT_ADDRESS;
    if (!pickProvider()) {
      // No wallet (yet): chain reads route through the wallet, so there is
      // nothing to query — stay neutral instead of erroring.
      setStatus("info", "Connect a wallet to see live sale state and mint.");
      updateMintButton(false);
      return;
    }
    try {
      var results = await Promise.all([
        ethCall(cfg.SELECTORS.totalSupply),
        ethCall(cfg.SELECTORS.mintPrice),
        ethCall(cfg.SELECTORS.saleActive),
        ethCall(cfg.SELECTORS.maxSupply),
      ]);
      var minted = parseUint256(results[0]);
      var priceWei = parseUint256(results[1]);
      var saleActive = parseUint256(results[2]) !== 0;
      var max = parseUint256(results[3]);

      $("supply").textContent = minted + " / " + max;
      $("sale").textContent = saleActive ? "live" : "closed";
      $("sale").style.color = saleActive ? "#8fd18f" : "#e08080";

      var priceOk = weiEquals(results[1], cfg.MINT_PRICE_WEI_HEX);
      if (!priceOk) {
        setStatus("err", "On-chain price differs from this page's config — do not mint until resolved.");
      } else if (!saleActive) {
        setStatus("info", "Sale is closed.");
      } else if (minted >= max) {
        setStatus("info", "Sold out.");
      }

      updateMintButton(saleActive && minted < max && priceOk && !!account);
    } catch (e) {
      setStatus("err", "Could not read contract state. Is your wallet on " + cfg.CHAIN_NAME + "?");
      updateMintButton(false);
    }
  }

  function updateMintButton(enabled) {
    var btn = $("mint");
    btn.disabled = !enabled;
    btn.textContent = account ? ("Mint — " + cfg.MINT_PRICE_ETH + " ETH") : "Mint — connect wallet first";
  }

  // ---------- wallet ----------
  async function connect() {
    provider = null; // re-resolve fresh on every attempt (late injection safe)
    solicitProviders();
    try { await new Promise(function (res) { setTimeout(res, 300); }); } catch (e) { /* ignore */ }
    var prov = ensureProvider();
    if (!prov) {
      setStatus("err", "No Ethereum wallet found. On mobile, open this page in your wallet app's built-in browser (e.g. MetaMask's browser). On desktop, install MetaMask or Rabby, then reload.");
      return;
    }
    try {
      var chainId = await rpc("eth_chainId", []);
      if (chainId.toLowerCase() !== cfg.CHAIN_ID.toLowerCase()) {
        setStatus("err", "Wrong network — switch your wallet to " + cfg.CHAIN_NAME + " and reconnect.");
        return;
      }
      var accounts = await rpc("eth_requestAccounts", []);
      if (!accounts || !accounts.length) {
        setStatus("err", "No accounts returned by wallet.");
        return;
      }
      account = accounts[0];
      $("wallet").textContent = shortAddress(account);
      $("wallet").style.color = "#e8e4d8";
      $("connect-wrap").style.display = "none";
      setStatus("", "");
      refresh();
    } catch (e) {
      setStatus("err", friendlyError(e));
    }
  }

  // ---------- mint ----------
  async function mint() {
    if (!account || !requireDeployed()) return;
    var btn = $("mint");
    btn.disabled = true;
    setStatus("info", "Confirm the transaction in your wallet…");
    try {
      var tx = buildMintTx(account, cfg.CONTRACT_ADDRESS, cfg.MINT_PRICE_WEI_HEX);
      var hash = await rpc("eth_sendTransaction", [tx]);
      setStatus("ok",
        'Submitted. <a href="' + cfg.EXPLORER_TX_BASE + hash + '" target="_blank" rel="noopener">View on Etherscan</a>');
      // Give the chain a moment, then refresh the counters.
      setTimeout(refresh, 4000);
    } catch (e) {
      setStatus("err", friendlyError(e));
    } finally {
      refresh();
    }
  }

  // ---------- wire up ----------
  if (typeof document !== "undefined") {
    $("connect").addEventListener("click", connect);
    $("mint").addEventListener("click", mint);
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("eip6963:announceProvider", handleAnnounce);
    }
    solicitProviders();
    ensureProvider(); // wire wallet events now if a provider is already injected
    refresh();
  }

  // Export pure helpers for node unit tests.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { shortAddress: shortAddress, parseUint256: parseUint256,
      weiEquals: weiEquals, selectProvider: selectProvider,
      buildMintTx: buildMintTx, friendlyError: friendlyError };
  }
})();
