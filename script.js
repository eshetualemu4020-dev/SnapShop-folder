// Maximum file size in megabytes
const MAX_FILE_MB = 10;

// Application State
let db = null;
let currentCategory = "All";
let isOwnerMode = false;
let cartIds = [];
let activeObjectUrls = [];
let deleteTargetPhotoId = null;
let lastFocusedElementBeforeCart = null;
let persistentStorageGranted = false;

// DOM Elements
const ownerToggle = document.getElementById("owner-toggle");
const ownerSection = document.getElementById("owner-section");
const statusLine = document.getElementById("status-line");
const photoGrid = document.getElementById("photo-grid");
const uploadForm = document.getElementById("upload-form");
const fileInput = document.getElementById("file-input");
const photoTitleInput = document.getElementById("photo-title");
const photoPriceInput = document.getElementById("photo-price");
const photoCategorySelect = document.getElementById("photo-category");
const uploadBtn = document.getElementById("upload-btn");
const exportBackupBtn = document.getElementById("export-backup-btn");
const importBackupBtn = document.getElementById("import-backup-btn");
const importBackupInput = document.getElementById("import-backup-input");
const storageCountEl = document.getElementById("storage-count");
const storageMbEl = document.getElementById("storage-mb");
const storagePersistEl = document.getElementById("storage-persist");
const categoryButtons = document.querySelectorAll(".filter-btn");

// Cart Elements
const cartOpenBtn = document.getElementById("cart-open-btn");
const cartCloseBtn = document.getElementById("cart-close-btn");
const cartDrawer = document.getElementById("cart-drawer");
const cartBackdrop = document.getElementById("cart-backdrop");
const cartBadge = document.getElementById("cart-badge");
const drawerItemCount = document.getElementById("drawer-item-count");
const cartItemsContainer = document.getElementById("cart-items");
const cartTotalAmountEl = document.getElementById("cart-total-amount");
const cartClearBtn = document.getElementById("cart-clear-btn");
const cartCheckoutBtn = document.getElementById("cart-checkout-btn");

// Confirm Dialog Elements
const confirmDialog = document.getElementById("confirm-dialog");
const confirmCancelBtn = document.getElementById("confirm-cancel-btn");
const confirmDeleteBtn = document.getElementById("confirm-delete-btn");

// ==========================================================================
// Status Line Helper (User text safety: uses textContent, no alert())
// ==========================================================================
function setStatus(message, type = "normal") {
  statusLine.textContent = message;
  statusLine.classList.remove("status-success", "status-error");
  if (type === "success") {
    statusLine.classList.add("status-success");
  } else if (type === "error") {
    statusLine.classList.add("status-error");
  }
}

// ==========================================================================
// IndexedDB Initialization
// ==========================================================================
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("snapshop-db", 1);

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains("photos")) {
        database.createObjectStore("photos", { keyPath: "id", autoIncrement: true });
      }
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };

    request.onerror = (event) => {
      setStatus("Failed to open database: " + event.target.error, "error");
      reject(event.target.error);
    };
  });
}

// IndexedDB Helper Functions
function getAllPhotosFromDB() {
  return new Promise((resolve, reject) => {
    if (!db) {
      resolve([]);
      return;
    }
    const tx = db.transaction("photos", "readonly");
    const store = tx.objectStore("photos");
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = (e) => reject(e.target.error);
  });
}

function getPhotoByIdFromDB(id) {
  return new Promise((resolve, reject) => {
    if (!db) {
      resolve(null);
      return;
    }
    const tx = db.transaction("photos", "readonly");
    const store = tx.objectStore("photos");
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = (e) => reject(e.target.error);
  });
}

function addPhotoToDB(record) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    const tx = db.transaction("photos", "readwrite");
    const store = tx.objectStore("photos");
    const request = store.add(record);

    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

function deletePhotoFromDB(id) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    const tx = db.transaction("photos", "readwrite");
    const store = tx.objectStore("photos");
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);
  });
}

// ==========================================================================
// Persistent Storage Request & Storage Info
// ==========================================================================
async function initPersistentStorage() {
  if (navigator.storage && navigator.storage.persist) {
    try {
      persistentStorageGranted = await navigator.storage.persist();
    } catch {
      persistentStorageGranted = false;
    }
  } else {
    persistentStorageGranted = false;
  }
}

async function updateStorageInfo() {
  try {
    const photos = await getAllPhotosFromDB();
    const count = photos.length;
    let totalBytes = 0;
    for (const p of photos) {
      if (p.full && p.full.size) totalBytes += p.full.size;
      if (p.thumb && p.thumb.size) totalBytes += p.thumb.size;
    }
    const mbUsed = (totalBytes / (1024 * 1024)).toFixed(2);

    storageCountEl.textContent = String(count);
    storageMbEl.textContent = `${mbUsed} MB`;
    storagePersistEl.textContent = persistentStorageGranted ? "Granted" : "Standard";
  } catch (err) {
    console.error("Error updating storage info:", err);
  }
}

// ==========================================================================
// Thumbnail Generator with Transparent PNG Support
// ==========================================================================
async function generateThumbnail(sourceBlob) {
  const bitmap = await createImageBitmap(sourceBlob);
  const maxDim = 600;
  let targetWidth = bitmap.width;
  let targetHeight = bitmap.height;

  if (targetWidth > maxDim || targetHeight > maxDim) {
    if (targetWidth >= targetHeight) {
      targetHeight = Math.round((maxDim * targetHeight) / targetWidth);
      targetWidth = maxDim;
    } else {
      targetWidth = Math.round((maxDim * targetWidth) / targetHeight);
      targetHeight = maxDim;
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");

  // Step 2 & 3: Fill complete canvas with white before drawing image
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

  // Close bitmap to release memory
  if (typeof bitmap.close === "function") {
    bitmap.close();
  }

  // Export as JPEG Blob
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Thumbnail generation failed"));
      }
    }, "image/jpeg", 0.85);
  });
}

// ==========================================================================
// Object URL Management & Responsive Photo Grid Rendering
// ==========================================================================
function revokeActiveObjectUrls() {
  activeObjectUrls.forEach((url) => {
    try {
      URL.revokeObjectURL(url);
    } catch {}
  });
  activeObjectUrls = [];
}

async function renderGrid() {
  // Step 1: Revoke previous object URLs
  revokeActiveObjectUrls();

  // Step 2: Clear previous grid
  photoGrid.innerHTML = "";

  const allPhotos = await getAllPhotosFromDB();

  // Filter based on active category
  const filteredPhotos = currentCategory === "All"
    ? allPhotos
    : allPhotos.filter((p) => p.cat === currentCategory);

  // Handle Empty States
  if (allPhotos.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No photos yet.";
    photoGrid.appendChild(empty);
    return;
  }

  if (filteredPhotos.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No photos found in this category.";
    photoGrid.appendChild(empty);
    return;
  }

  // Render cards
  const fragment = document.createDocumentFragment();

  filteredPhotos.forEach((photo) => {
    // Generate object URL for thumbnail
    const thumbUrl = URL.createObjectURL(photo.thumb);
    activeObjectUrls.push(thumbUrl);

    const isInCart = cartIds.includes(photo.id);

    const card = document.createElement("article");
    card.className = "photo-card";
    card.dataset.id = String(photo.id);

    // Media container
    const mediaDiv = document.createElement("div");
    mediaDiv.className = "card-media";

    const img = document.createElement("img");
    img.src = thumbUrl;
    img.alt = "";
    img.className = "card-thumb";
    img.loading = "lazy";

    const catBadge = document.createElement("span");
    catBadge.className = "card-badge-category";
    catBadge.textContent = photo.cat;

    mediaDiv.appendChild(img);
    mediaDiv.appendChild(catBadge);

    // Content container
    const contentDiv = document.createElement("div");
    contentDiv.className = "card-content";

    const headerRow = document.createElement("div");
    headerRow.className = "card-header-row";

    const titleEl = document.createElement("h3");
    titleEl.className = "card-title";
    titleEl.textContent = photo.title; // Secure textContent

    const priceEl = document.createElement("span");
    priceEl.className = "card-price";
    priceEl.textContent = String(photo.price); // Numeric price only

    headerRow.appendChild(titleEl);
    headerRow.appendChild(priceEl);

    // Actions container
    const actionsDiv = document.createElement("div");
    actionsDiv.className = "card-actions";

    const cartBtn = document.createElement("button");
    cartBtn.type = "button";
    cartBtn.className = "btn btn-cart";
    cartBtn.dataset.action = "add-cart";
    cartBtn.dataset.id = String(photo.id);
    if (isInCart) {
      cartBtn.textContent = "In cart";
      cartBtn.disabled = true;
    } else {
      cartBtn.textContent = "Add to cart";
      cartBtn.disabled = false;
    }

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn btn-delete owner-only";
    deleteBtn.dataset.action = "delete";
    deleteBtn.dataset.id = String(photo.id);
    deleteBtn.textContent = "Delete";

    actionsDiv.appendChild(cartBtn);
    actionsDiv.appendChild(deleteBtn);

    contentDiv.appendChild(headerRow);
    contentDiv.appendChild(actionsDiv);

    card.appendChild(mediaDiv);
    card.appendChild(contentDiv);

    fragment.appendChild(card);
  });

  photoGrid.appendChild(fragment);
}

// ==========================================================================
// Cart Management & Persistence
// ==========================================================================
function saveCartToStorage() {
  try {
    localStorage.setItem("snapshop_cart", JSON.stringify(cartIds));
  } catch (err) {
    console.error("Failed to save cart to localStorage:", err);
  }
}

async function loadAndCleanCart() {
  try {
    const raw = localStorage.getItem("snapshop_cart");
    const parsed = raw ? JSON.parse(raw) : [];
    const validIds = Array.isArray(parsed) ? parsed : [];

    // Verify each ID exists in IndexedDB
    const allPhotos = await getAllPhotosFromDB();
    const existingIds = new Set(allPhotos.map((p) => p.id));

    cartIds = validIds.filter((id) => existingIds.has(id));
    saveCartToStorage();
    renderCart();
  } catch (err) {
    console.error("Failed loading cart:", err);
    cartIds = [];
    saveCartToStorage();
    renderCart();
  }
}

async function renderCart() {
  cartBadge.textContent = String(cartIds.length);
  drawerItemCount.textContent = String(cartIds.length);

  // Clear previous items
  cartItemsContainer.innerHTML = "";

  if (cartIds.length === 0) {
    const emptyP = document.createElement("p");
    emptyP.className = "cart-empty";
    emptyP.textContent = "Your cart is empty.";
    cartItemsContainer.appendChild(emptyP);
    cartTotalAmountEl.textContent = "0";
    cartCheckoutBtn.disabled = true;
    cartClearBtn.disabled = true;
    return;
  }

  cartCheckoutBtn.disabled = false;
  cartClearBtn.disabled = false;

  let total = 0;
  const fragment = document.createDocumentFragment();

  for (const id of cartIds) {
    const photo = await getPhotoByIdFromDB(id);
    if (!photo) continue;

    total += Number(photo.price) || 0;

    const itemDiv = document.createElement("div");
    itemDiv.className = "cart-item";
    itemDiv.dataset.id = String(photo.id);

    const img = document.createElement("img");
    const thumbUrl = URL.createObjectURL(photo.thumb);
    activeObjectUrls.push(thumbUrl);
    img.src = thumbUrl;
    img.alt = "";
    img.className = "cart-item-thumb";

    const detailsDiv = document.createElement("div");
    detailsDiv.className = "cart-item-details";

    const titleEl = document.createElement("div");
    titleEl.className = "cart-item-title";
    titleEl.textContent = photo.title; // User text safety

    const priceEl = document.createElement("div");
    priceEl.className = "cart-item-price";
    priceEl.textContent = String(photo.price);

    detailsDiv.appendChild(titleEl);
    detailsDiv.appendChild(priceEl);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "cart-item-remove-btn";
    removeBtn.dataset.action = "remove-cart";
    removeBtn.dataset.id = String(photo.id);
    removeBtn.textContent = "Remove";

    itemDiv.appendChild(img);
    itemDiv.appendChild(detailsDiv);
    itemDiv.appendChild(removeBtn);

    fragment.appendChild(itemDiv);
  }

  // Format total (avoid rounding float noise)
  cartTotalAmountEl.textContent = String(Math.round(total * 100) / 100);
  cartItemsContainer.appendChild(fragment);
}

function addToCart(photoId) {
  const numId = Number(photoId);
  if (!cartIds.includes(numId)) {
    cartIds.push(numId);
    saveCartToStorage();
    renderCart();
    renderGrid();
    setStatus("Photo added to cart.", "success");
  }
}

function removeFromCart(photoId) {
  const numId = Number(photoId);
  cartIds = cartIds.filter((id) => id !== numId);
  saveCartToStorage();
  renderCart();
  renderGrid();
  setStatus("Photo removed from cart.");
}

function clearCart() {
  cartIds = [];
  saveCartToStorage();
  renderCart();
  renderGrid();
  setStatus("Cart cleared.");
}

// Cart Drawer Accessibility (Open / Close / Focus trap / Escape key)
function openCart() {
  lastFocusedElementBeforeCart = document.activeElement;
  cartBackdrop.hidden = false;
  cartDrawer.hidden = false;
  cartOpenBtn.setAttribute("aria-expanded", "true");
  cartCloseBtn.focus();
}

function closeCart() {
  cartBackdrop.hidden = true;
  cartDrawer.hidden = true;
  cartOpenBtn.setAttribute("aria-expanded", "false");
  if (lastFocusedElementBeforeCart && typeof lastFocusedElementBeforeCart.focus === "function") {
    lastFocusedElementBeforeCart.focus();
  }
}

// ==========================================================================
// Owner Mode Toggle & Local Storage
// ==========================================================================
function initOwnerMode() {
  const saved = localStorage.getItem("snapshop_owner_mode");
  isOwnerMode = saved === "true";
  ownerToggle.checked = isOwnerMode;
  applyOwnerMode();
}

function applyOwnerMode() {
  document.body.classList.toggle("owner-mode-active", isOwnerMode);
  ownerSection.hidden = !isOwnerMode;
  localStorage.setItem("snapshop_owner_mode", String(isOwnerMode));
}

// ==========================================================================
// Multi-File Upload & Robust Validation
// ==========================================================================
uploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const files = Array.from(fileInput.files);
  if (files.length === 0) {
    setStatus("Please select at least one image file.", "error");
    return;
  }

  const rawTitle = photoTitleInput.value.trim();
  const priceVal = parseFloat(photoPriceInput.value);
  const catVal = photoCategorySelect.value;

  if (isNaN(priceVal) || priceVal < 0) {
    setStatus("Please enter a valid price.", "error");
    return;
  }

  uploadBtn.disabled = true;
  setStatus(`Processing ${files.length} file(s)...`);

  let successCount = 0;
  const failureMessages = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    // File title: if not entered, use original filename
    const title = rawTitle
      ? (files.length > 1 ? `${rawTitle} (${i + 1})` : rawTitle)
      : file.name;

    // 1. File Size Validation
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      failureMessages.push(`${file.name} — file exceeds the ${MAX_FILE_MB} MB limit.`);
      continue;
    }

    // 2. Decode Validation using createImageBitmap
    let thumbBlob;
    try {
      thumbBlob = await generateThumbnail(file);
    } catch {
      failureMessages.push(`${file.name} — image could not be decoded by this browser.`);
      continue;
    }

    // 3. IndexedDB Storage with QuotaExceededError handling
    try {
      const record = {
        title,
        price: priceVal,
        cat: catVal,
        added: Date.now(),
        full: file,
        thumb: thumbBlob,
      };
      await addPhotoToDB(record);
      successCount++;
    } catch (err) {
      if (err && (err.name === "QuotaExceededError" || err.code === 22)) {
        failureMessages.push(`${file.name} — browser storage quota was exceeded.`);
      } else {
        failureMessages.push(`${file.name} — failed to save (${err?.message || "storage error"}).`);
      }
    }
  }

  // Reset form inputs
  uploadForm.reset();
  uploadBtn.disabled = false;

  // Re-render and update storage info
  await renderGrid();
  await updateStorageInfo();

  // Construct status report
  if (failureMessages.length === 0) {
    setStatus(`Successfully uploaded ${successCount} photo(s).`, "success");
  } else if (successCount > 0) {
    setStatus(`Uploaded ${successCount} photo(s). Failed: ${failureMessages.join(" ")}`, "error");
  } else {
    setStatus(`Upload failed: ${failureMessages.join(" ")}`, "error");
  }
});

// ==========================================================================
// Delete Confirmation Dialog & Execution
// ==========================================================================
function openDeleteConfirm(photoId) {
  deleteTargetPhotoId = Number(photoId);
  if (typeof confirmDialog.showModal === "function") {
    confirmDialog.showModal();
  } else {
    // Fallback if dialog tag not supported
    executeDeletePhoto(deleteTargetPhotoId);
  }
}

confirmCancelBtn.addEventListener("click", () => {
  confirmDialog.close();
  deleteTargetPhotoId = null;
});

confirmDeleteBtn.addEventListener("click", async () => {
  confirmDialog.close();
  if (deleteTargetPhotoId !== null) {
    await executeDeletePhoto(deleteTargetPhotoId);
    deleteTargetPhotoId = null;
  }
});

async function executeDeletePhoto(id) {
  try {
    await deletePhotoFromDB(id);

    // Remove photo from cart if present
    if (cartIds.includes(id)) {
      cartIds = cartIds.filter((cartId) => cartId !== id);
      saveCartToStorage();
      await renderCart();
    }

    await renderGrid();
    await updateStorageInfo();
    setStatus("Photo deleted successfully.", "success");
  } catch (err) {
    setStatus("Failed to delete photo: " + err.message, "error");
  }
}

// ==========================================================================
// Backup Export & Import (Merge, exact duplicate detection, skipping invalid)
// ==========================================================================
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = (e) => reject(e);
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const parts = dataUrl.split(",");
  const mime = parts[0].match(/:(.*?);/)[1];
  const binaryStr = atob(parts[1]);
  const len = binaryStr.length;
  const u8arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    u8arr[i] = binaryStr.charCodeAt(i);
  }
  return new Blob([u8arr], { type: mime });
}

// Helper to compute a SHA-256 fingerprint of image binary data
async function getImageFingerprint(blob) {
  const buffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

exportBackupBtn.addEventListener("click", async () => {
  try {
    setStatus("Exporting backup...");
    const photos = await getAllPhotosFromDB();
    const backupPhotos = [];

    for (const p of photos) {
      const dataUrl = await blobToDataUrl(p.full);
      backupPhotos.push({
        title: p.title,
        price: p.price,
        cat: p.cat,
        added: p.added || Date.now(),
        dataUrl,
      });
    }

    const backupObject = {
      app: "snapshop",
      version: 1,
      photos: backupPhotos,
    };

    const jsonString = JSON.stringify(backupObject, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `snapshop-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setStatus("Backup exported successfully.", "success");
  } catch (err) {
    setStatus("Export backup failed: " + err.message, "error");
  }
});

importBackupBtn.addEventListener("click", () => {
  importBackupInput.value = "";
  importBackupInput.click();
});

importBackupInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  setStatus("Reading backup file...");

  let text;
  try {
    text = await file.text();
  } catch (err) {
    setStatus("Failed to read backup file.", "error");
    return;
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    setStatus("Invalid backup file: Not valid JSON.", "error");
    return;
  }

  // Validate top-level structure
  if (!data || data.app !== "snapshop" || !Array.isArray(data.photos)) {
    setStatus("Invalid backup file: Missing snapshop format signature.", "error");
    return;
  }

  // Pre-calculate existing fingerprints to detect exact duplicates
  const existingPhotos = await getAllPhotosFromDB();
  const existingFingerprints = new Set();
  for (const ep of existingPhotos) {
    try {
      const fp = await getImageFingerprint(ep.full);
      existingFingerprints.add(fp);
    } catch {}
  }

  let addedCount = 0;
  let exactDuplicatesCount = 0;
  let invalidRecordsCount = 0;

  for (const record of data.photos) {
    // Validate record fields
    if (
      !record ||
      typeof record.title !== "string" ||
      typeof record.price !== "number" ||
      isNaN(record.price) ||
      record.price < 0 ||
      typeof record.dataUrl !== "string" ||
      !record.dataUrl.startsWith("data:image/")
    ) {
      invalidRecordsCount++;
      continue;
    }

    const cat = ["Nature", "City", "People", "Animals", "Other"].includes(record.cat)
      ? record.cat
      : "Other";

    let fullBlob;
    try {
      fullBlob = dataUrlToBlob(record.dataUrl);
    } catch {
      invalidRecordsCount++;
      continue;
    }

    // Check exact duplicate
    let fingerprint;
    try {
      fingerprint = await getImageFingerprint(fullBlob);
    } catch {
      fingerprint = null;
    }

    if (fingerprint && existingFingerprints.has(fingerprint)) {
      exactDuplicatesCount++;
      continue;
    }

    // Generate thumbnail
    let thumbBlob;
    try {
      thumbBlob = await generateThumbnail(fullBlob);
    } catch {
      invalidRecordsCount++;
      continue;
    }

    // Save record
    try {
      await addPhotoToDB({
        title: record.title,
        price: record.price,
        cat,
        added: record.added || Date.now(),
        full: fullBlob,
        thumb: thumbBlob,
      });
      if (fingerprint) {
        existingFingerprints.add(fingerprint);
      }
      addedCount++;
    } catch {
      invalidRecordsCount++;
    }
  }

  await renderGrid();
  await updateStorageInfo();

  setStatus(
    `Import complete: ${addedCount} added, ${exactDuplicatesCount} exact duplicates skipped, ${invalidRecordsCount} invalid record skipped.`,
    addedCount > 0 ? "success" : "normal"
  );
});

// ==========================================================================
// Category Filters
// ==========================================================================
categoryButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    categoryButtons.forEach((b) => b.setAttribute("aria-pressed", "false"));
    btn.setAttribute("aria-pressed", "true");
    currentCategory = btn.dataset.cat || "All";
    renderGrid();
  });
});

// ==========================================================================
// Event Delegation
// ==========================================================================
// 1. Photo Grid Event Delegation (Add to cart & Delete)
photoGrid.addEventListener("click", (e) => {
  const addBtn = e.target.closest('[data-action="add-cart"]');
  if (addBtn && !addBtn.disabled) {
    const id = addBtn.dataset.id;
    addToCart(id);
    return;
  }

  const delBtn = e.target.closest('[data-action="delete"]');
  if (delBtn) {
    const id = delBtn.dataset.id;
    openDeleteConfirm(id);
    return;
  }
});

// 2. Cart Items Event Delegation (Remove button)
cartItemsContainer.addEventListener("click", (e) => {
  const removeBtn = e.target.closest('[data-action="remove-cart"]');
  if (removeBtn) {
    const id = removeBtn.dataset.id;
    removeFromCart(id);
  }
});

// Cart Drawer Buttons
cartOpenBtn.addEventListener("click", openCart);
cartCloseBtn.addEventListener("click", closeCart);
cartBackdrop.addEventListener("click", closeCart);
cartClearBtn.addEventListener("click", clearCart);

// Demo Checkout
cartCheckoutBtn.addEventListener("click", () => {
  if (cartIds.length === 0) return;
  const total = cartTotalAmountEl.textContent;
  const count = cartIds.length;
  cartIds = [];
  saveCartToStorage();
  renderCart();
  renderGrid();
  closeCart();
  setStatus(`Demo checkout successful! Paid ${total} for ${count} photo(s). Cart cleared.`, "success");
});

// Keyboard Accessibility: Escape key closes cart and confirm dialog
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!cartDrawer.hidden) {
      closeCart();
    }
  }
});

// Owner Mode Toggle Listener
ownerToggle.addEventListener("change", (e) => {
  isOwnerMode = e.target.checked;
  applyOwnerMode();
  renderGrid(); // update grid to show/hide delete buttons
  if (isOwnerMode) {
    updateStorageInfo();
  }
});

// ==========================================================================
// Application Bootstrap
// ==========================================================================
async function init() {
  initOwnerMode();
  await initDB();
  await initPersistentStorage();
  await updateStorageInfo();
  await loadAndCleanCart();
  await renderGrid();
}

window.addEventListener("DOMContentLoaded", init);
