// Screenshots open in a dialog, fitted to the window; clicking the image shows it at full size.
// Without JavaScript the link opens the image itself.
const dialog = document.createElement('dialog');
dialog.className = 'viewer';
dialog.innerHTML =
  '<button class="close" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg></button><img alt="" />';
document.body.append(dialog);
const img = dialog.querySelector('img');
for (const link of document.querySelectorAll('a.zoom')) {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    img.src = link.href;
    img.alt = link.querySelector('img').alt;
    dialog.classList.remove('full');
    dialog.showModal();
  });
}
img.addEventListener('click', () => dialog.classList.toggle('full'));
dialog.addEventListener('click', (event) => {
  if (event.target === dialog || event.target.closest('.close')) dialog.close();
});
