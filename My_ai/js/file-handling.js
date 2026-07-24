// ═══════════════════════════════════════════════════════════════════════
// file-handling.js — PDF.js worker setup, file attach/PDF text extraction,
// image lightbox/gallery.
// ═══════════════════════════════════════════════════════════════════════

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js';
}


let lbIndex = 0;

function registerGalleryImage(src, caption) {
  galleryImages.push({ src, caption: caption || '' });
  return galleryImages.length - 1;
}

function makeClickableImg(imgEl, caption) {
  imgEl.style.cursor = 'pointer';
  const idx = registerGalleryImage(imgEl.src, caption);
  imgEl.addEventListener('click', () => openLightbox(idx));
  return imgEl;
}

function openLightbox(idx) {
  lbIndex = idx;
  updateLightbox();
  document.getElementById('lightbox').classList.remove('hidden');
}

function closeLightbox() {
  document.getElementById('lightbox').classList.add('hidden');
}

function updateLightbox() {
  const item = galleryImages[lbIndex];
  if (!item) return;
  document.getElementById('lightbox-img').src = item.src;
  document.getElementById('lb-caption').textContent = item.caption;
  document.getElementById('lb-prev').classList.toggle('hidden-nav', lbIndex <= 0);
  document.getElementById('lb-next').classList.toggle('hidden-nav', lbIndex >= galleryImages.length - 1);
}

function lbPrev() { if (lbIndex > 0) { lbIndex--; updateLightbox(); } }

function lbNext() { if (lbIndex < galleryImages.length - 1) { lbIndex++; updateLightbox(); } }

function lbDownload() {
  const item = galleryImages[lbIndex];
  if (!item) return;
  const a = document.createElement('a');
  a.href = item.src;
  const safeName = (item.caption || 'chaman-ai-image').replace(/[^a-z0-9]+/gi, '_').slice(0, 40) || 'image';
  a.download = safeName + '.jpg';
  document.body.appendChild(a);
  a.click();
  a.remove();
}


async function handleFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  if (file.size > 10 * 1024 * 1024) { toast('File bahut badi hai (max 10MB)'); return; }

  const ext = file.name.split('.').pop().toLowerCase();
  const isImg = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext);
  const isTxt = [
    'txt', 'md', 'csv',
    // code / dev files
    'py', 'js', 'jsx', 'ts', 'tsx', 'html', 'htm', 'css', 'scss', 'sass',
    'java', 'c', 'cpp', 'cc', 'h', 'hpp', 'cs', 'php', 'rb', 'go', 'rs',
    'swift', 'kt', 'kts', 'dart', 'lua', 'r', 'pl', 'vue', 'svelte',
    'json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'env', 'sql', 'sh',
    'bat', 'ps1', 'log', 'gradle', 'dockerfile', 'makefile', 'lock'
  ].includes(ext);
  const isPDF = ext === 'pdf';

  const prev = document.getElementById('file-preview');
  const fpImg = document.getElementById('fp-img');
  const fpName = document.getElementById('fp-name');

  if (isImg) {
    const reader = new FileReader();
    reader.onload = ev => {
      const b64 = ev.target.result.split(',')[1];
      attachedFile = { type: 'image', data: b64, name: file.name, mimeType: file.type || 'image/jpeg' };
      fpImg.src = ev.target.result;
      fpImg.style.display = 'block';
      fpName.textContent = '📷 ' + file.name;
      prev.classList.add('show');
      toast('📷 Image ready!');
    };
    reader.readAsDataURL(file);
  } else if (isTxt) {
    const reader = new FileReader();
    reader.onload = ev => {
      attachedFile = { type: 'text', data: ev.target.result, name: file.name };
      fpImg.style.display = 'none';
      fpName.textContent = '📄 ' + file.name;
      prev.classList.add('show');
      toast('📄 File ready!');
    };
    reader.readAsText(file);
  } else if (isPDF) {
    if (!window.pdfjsLib) { toast('❌ PDF reader load nahi hui, internet check karo'); return; }
    fpImg.style.display = 'none';
    fpName.textContent = '📕 ' + file.name + ' (padh raha hai...)';
    prev.classList.add('show');
    try {
      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      let text = '';
      const maxPages = Math.min(pdf.numPages, 30);
      for (let i = 1; i <= maxPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(it => it.str).join(' ') + '\n\n';
        if (text.length > 8000) break;
      }
      text = text.trim().slice(0, 8000);
      if (!text) { toast('⚠️ PDF se text nahi mila (scanned ho sakta hai)'); prev.classList.remove('show'); return; }
      attachedFile = { type: 'pdf', data: text, name: file.name };
      fpName.textContent = '📕 ' + file.name;
      toast('📕 PDF ready! (' + pdf.numPages + ' pages)');
    } catch (err) {
      toast('❌ PDF read nahi ho payi: ' + err.message);
      prev.classList.remove('show');
    }
  } else {
    toast('Ye file type supported nahi hai');
  }
}

function clearFile() {
  attachedFile = null;
  const prev = document.getElementById('file-preview');
  prev.classList.remove('show');
  document.getElementById('fp-img').style.display = 'none';
  document.getElementById('fp-img').src = '';
}