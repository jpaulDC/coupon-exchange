const CONTRACT_ADDRESS = "0x358AA13c52544ECCEF6B0ADD0f801012ADAD5eE3";
const SEPOLIA_CHAIN_ID = 11155111;

// ABI = list of the contract functions/events the website may use.
// It matches DigitalCouponExchange.sol exactly.
const COUPON = "tuple(uint256 id, string name, uint256 discountPercent, uint256 expiration, address owner)";
const OFFER = "tuple(uint256 id, address creator, uint256 offeredCouponId, uint256 requestedCouponId, bool active)";
const ABI = [
  "function admin() view returns (address)",
  "function couponCount() view returns (uint256)",
  "function offerCount() view returns (uint256)",
  "function createCoupon(string _name, uint256 _discountPercent, uint256 _expiration)",
  "function claimCoupon(uint256 _couponId)",
  "function createOffer(uint256 _offeredCouponId, uint256 _requestedCouponId)",
  "function acceptOffer(uint256 _offerId)",
  "function cancelOffer(uint256 _offerId)",
  `function getCoupon(uint256 _couponId) view returns (${COUPON})`,
  `function getAllCoupons() view returns (${COUPON}[])`,
  `function getOffer(uint256 _offerId) view returns (${OFFER})`,
  `function getAllOffers() view returns (${OFFER}[])`,
  "event CouponCreated(uint256 indexed couponId, string name, uint256 discountPercent, uint256 expiration)",
  "event CouponClaimed(uint256 indexed couponId, address indexed claimer)",
  "event OfferCreated(uint256 indexed offerId, address indexed creator, uint256 offeredCouponId, uint256 requestedCouponId)",
  "event OfferAccepted(uint256 indexed offerId, address indexed accepter)",
  "event OfferCancelled(uint256 indexed offerId)"
];

// =====================================================
// STATE AND SMALL HELPERS
// =====================================================
const ZERO = "0x0000000000000000000000000000000000000000";
let provider, signer, contract, account, adminAddress;
let coupons = [];
let offers = [];

const $ = (id) => document.getElementById(id);
const nowSec = () => Math.floor(Date.now() / 1000);
const isExpired = (c) => c.expiration <= nowSec();
const isAvailable = (c) => c.owner === ZERO && !isExpired(c);
const sameAddr = (a, b) => a.toLowerCase() === b.toLowerCase();
const shortAddr = (a) => a.slice(0, 6) + "..." + a.slice(-4);
const byId = (id) => coupons.find((c) => c.id === id);
const fmtDate = (ts) => new Date(ts * 1000).toLocaleString();

// Prevents text from being treated as HTML
function esc(text) {
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}

function setStatus(message, type) {
  const box = $("status");
  box.className = "status " + type;
  box.textContent = message;
}

function readError(e) {
  return e.reason || e.shortMessage || (e.info && e.info.error && e.info.error.message) || e.message || "Unknown error";
}

// =====================================================
// WALLET CONNECTION
// =====================================================
async function connectWallet() {
  if (!window.ethereum) {
    setStatus("MetaMask not found. Install the MetaMask extension in Chrome.", "error");
    return;
  }
  if (!ethers.isAddress(CONTRACT_ADDRESS)) {
    setStatus("Set CONTRACT_ADDRESS in app.js to your deployed contract address first.", "error");
    return;
  }
  try {
    provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);

    let net = await provider.getNetwork();
    if (Number(net.chainId) !== SEPOLIA_CHAIN_ID) {
      try {
        await provider.send("wallet_switchEthereumChain", [{ chainId: "0xaa36a7" }]);
      } catch (err) {
        setStatus("Please switch MetaMask to the Sepolia test network.", "error");
        return;
      }
      provider = new ethers.BrowserProvider(window.ethereum);
      net = await provider.getNetwork();
    }

    const code = await provider.getCode(CONTRACT_ADDRESS);
    if (code === "0x") {
      setStatus("No contract found at CONTRACT_ADDRESS on this network. Check the address.", "error");
      return;
    }

    signer = await provider.getSigner();
    account = await signer.getAddress();
    contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
    adminAddress = await contract.admin();

    $("network").textContent = net.name + " (chain " + net.chainId + ")";
    $("account").textContent = shortAddr(account);
    $("connectBtn").textContent = "Connected";
    $("adminTab").classList.toggle("hidden", !sameAddr(account, adminAddress));

    setStatus("Wallet connected.", "success");
    await loadData();
  } catch (e) {
    setStatus("Connection failed: " + readError(e), "error");
  }
}

// =====================================================
// READ FUNCTIONS (free, no MetaMask popup)
// =====================================================
async function loadData() {
  try {
    const rawCoupons = await contract.getAllCoupons();
    coupons = rawCoupons.map((c) => ({
      id: Number(c.id),
      name: c.name,
      discount: Number(c.discountPercent),
      expiration: Number(c.expiration),
      owner: c.owner
    }));
    const rawOffers = await contract.getAllOffers();
    offers = rawOffers.map((o) => ({
      id: Number(o.id),
      creator: o.creator,
      offered: Number(o.offeredCouponId),
      requested: Number(o.requestedCouponId),
      active: o.active
    }));
    render();
  } catch (e) {
    setStatus("Could not load data: " + readError(e), "error");
  }
}

// =====================================================
// WRITE FUNCTIONS (need MetaMask confirmation)
// =====================================================
// Waits for real blockchain confirmation before reporting success.
async function sendTx(label, action) {
  if (!contract) {
    setStatus("Connect your wallet first.", "error");
    return false;
  }
  try {
    setStatus(label + ": please confirm in MetaMask...", "info");
    const tx = await action();
    setStatus(label + ": submitted, waiting for blockchain confirmation... (" + tx.hash + ")", "info");
    await tx.wait();
    setStatus(label + ": confirmed on the blockchain ✔", "success");
    await loadData();
    return true;
  } catch (e) {
    setStatus(label + " failed: " + readError(e), "error");
    return false;
  }
}

// =====================================================
// RENDERING
// =====================================================
function couponCard(c, actionHtml) {
  let badge = '<span class="badge green">Available</span>';
  if (isExpired(c)) badge = '<span class="badge red">Expired</span>';
  else if (c.owner !== ZERO) badge = '<span class="badge">Owned by ' + shortAddr(c.owner) + "</span>";
  return `
    <div class="card">
      ${badge}
      <h4>${esc(c.name)}</h4>
      <div class="discount">${c.discount}% OFF</div>
      <small>ID: #${c.id}</small>
      <small>Expires: ${fmtDate(c.expiration)}</small>
      ${actionHtml || ""}
    </div>`;
}

function render() {
  const available = coupons.filter(isAvailable);
  const mine = coupons.filter((c) => sameAddr(c.owner, account));
  const activeOffers = offers.filter((o) => o.active);

  // Dashboard
  $("statTotal").textContent = coupons.length;
  $("statAvailable").textContent = available.length;
  $("statMine").textContent = mine.length;
  $("statOffers").textContent = activeOffers.length;

  // Coupon Marketplace
  $("marketList").innerHTML = available.length
    ? available.map((c) => couponCard(c, `<button data-action="claim" data-id="${c.id}">Claim</button>`)).join("")
    : '<p class="empty">No coupons are available right now.</p>';

  // My Coupons
  $("myList").innerHTML = mine.length
    ? mine.map((c) => couponCard(c, isExpired(c) ? "" : `<button data-action="exchange" data-id="${c.id}">Exchange</button>`)).join("")
    : '<p class="empty">You do not own any coupons yet.</p>';

  // Exchange Marketplace
  $("offerList").innerHTML = activeOffers.length
    ? activeOffers.map(offerCard).join("")
    : '<p class="empty">No active exchange offers.</p>';

  // Admin list
  $("adminList").innerHTML = coupons.length
    ? coupons.map((c) => couponCard(c)).join("")
    : '<p class="empty">No coupons created yet.</p>';
}

function offerCard(o) {
  const offered = byId(o.offered);
  const requested = byId(o.requested);
  let actions;
  if (sameAddr(o.creator, account)) {
    actions = `<button class="danger" data-action="cancel" data-id="${o.id}">Cancel Offer</button>`;
  } else if (sameAddr(requested.owner, account)) {
    actions = `<button data-action="accept" data-id="${o.id}">Accept</button>`;
  } else {
    actions = `<small>Only the owner of coupon #${requested.id} can accept.</small>`;
  }
  return `
    <div class="card">
      <span class="badge">Offer #${o.id}</span>
      <p><b>Offered:</b> ${esc(offered.name)} (#${offered.id}, ${offered.discount}%)</p>
      <p><b>Requested:</b> ${esc(requested.name)} (#${requested.id}, ${requested.discount}%)</p>
      <small>Creator: ${shortAddr(o.creator)}</small>
      ${actions}
    </div>`;
}

// =====================================================
// EVENTS (buttons, tabs, dialog)
// =====================================================
let pendingOfferedId = null;

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const id = Number(btn.dataset.id);
  const action = btn.dataset.action;

  if (action === "claim") sendTx("Claim coupon #" + id, () => contract.claimCoupon(id));
  if (action === "accept") sendTx("Accept offer #" + id, () => contract.acceptOffer(id));
  if (action === "cancel") sendTx("Cancel offer #" + id, () => contract.cancelOffer(id));
  if (action === "exchange") openExchangeDialog(id);
});

function openExchangeDialog(offeredId) {
  // Only coupons owned by someone else and not expired can be requested
  const choices = coupons.filter((c) => c.owner !== ZERO && !sameAddr(c.owner, account) && !isExpired(c));
  if (choices.length === 0) {
    setStatus("No coupons owned by other users are available to request yet.", "error");
    return;
  }
  pendingOfferedId = offeredId;
  $("dlgOffered").textContent = "#" + offeredId;
  $("dlgSelect").innerHTML = choices
    .map((c) => `<option value="${c.id}">#${c.id} ${esc(c.name)} (${c.discount}%), owner ${shortAddr(c.owner)}</option>`)
    .join("");
  $("exchangeDialog").showModal();
}

$("dlgConfirm").addEventListener("click", async () => {
  const requestedId = Number($("dlgSelect").value);
  $("exchangeDialog").close();
  await sendTx("Create offer", () => contract.createOffer(pendingOfferedId, requestedId));
});
$("dlgCancel").addEventListener("click", () => $("exchangeDialog").close());

$("addCouponBtn").addEventListener("click", async () => {
  const name = $("cName").value.trim();
  const discount = Number($("cDiscount").value);
  const dateValue = $("cExpiry").value;
  if (!name || !discount || !dateValue) {
    setStatus("Please fill in name, discount and expiration date.", "error");
    return;
  }
  const expiration = Math.floor(new Date(dateValue).getTime() / 1000);
  const ok = await sendTx("Add coupon", () => contract.createCoupon(name, discount, expiration));
  if (ok) {
    $("cName").value = "";
    $("cDiscount").value = "";
    $("cExpiry").value = "";
  }
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
    tab.classList.add("active");
    $("view-" + tab.dataset.view).classList.remove("hidden");
  });
});

$("connectBtn").addEventListener("click", connectWallet);

// Reload if the user switches account or network in MetaMask
if (window.ethereum) {
  window.ethereum.on("accountsChanged", () => window.location.reload());
  window.ethereum.on("chainChanged", () => window.location.reload());
}
