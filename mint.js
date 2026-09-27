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

  // ---------- provider state ----------
  var provider = (typeof window !== "undefined" && window.ethereum) ? window.ethereum : null;
  var account = null;

  function requireDeployed() {
    return cfg && /^0x[0-9a-fA-F]{40}$/.test(cfg.CONTRACT_ADDRESS) &&
      !/^0x0{40}$/.test(cfg.CONTRACT_ADDRESS);
  }

  async function rpc(method, params) {
    return provider.request({ method: method, params: params });
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
    if (!provider) {
      setStatus("err", "No Ethereum wallet found. Install MetaMask, Rabby, or another wallet, then reload.");
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
    if (provider && provider.on) {
      provider.on("accountsChanged", function (accs) {
        account = (accs && accs[0]) || null;
        $("wallet").textContent = account ? shortAddress(account) : "not connected";
        $("connect-wrap").style.display = account ? "none" : "";
        refresh();
      });
      provider.on("chainChanged", function () { window.location.reload(); });
    }
    refresh();
  }

  // Export pure helpers for node unit tests.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { shortAddress: shortAddress, parseUint256: parseUint256,
      weiEquals: weiEquals,
      buildMintTx: buildMintTx, friendlyError: friendlyError };
  }
})();
