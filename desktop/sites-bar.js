/* The bar on top of the approved-sites window. It only lists what main says is approved. */
const $ = (id) => document.getElementById(id);
let hosts = [];

function matchHost(h) {
  h = String(h || '').toLowerCase();
  return hosts.find((e) => h === e || h.endsWith('.' + e)) || '';
}

async function init() {
  hosts = (await window.sites.hosts()) || [];
  const sel = $('site');
  sel.innerHTML = '';
  const first = document.createElement('option');
  first.value = ''; first.textContent = 'Choose a site…';
  sel.appendChild(first);
  hosts.forEach((h) => { const o = document.createElement('option'); o.value = h; o.textContent = h; sel.appendChild(o); });
}

$('site').addEventListener('change', (e) => { if (e.target.value) window.sites.go(e.target.value); });
$('back').addEventListener('click', () => window.sites.back());
$('forward').addEventListener('click', () => window.sites.forward());
$('reload').addEventListener('click', () => window.sites.reload());
$('done').addEventListener('click', () => window.sites.done());

window.sites.onState((s) => {
  $('back').disabled = !s.canBack;
  $('forward').disabled = !s.canForward;
  $('title').textContent = s.title || s.host || '';
  $('site').value = matchHost(s.host);
});

init();
