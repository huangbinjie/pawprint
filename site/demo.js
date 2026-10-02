(() => {
  const scene = document.querySelector('.demo-scene');
  const tabs = [...document.querySelectorAll('[data-demo-state]')];
  const copy = JSON.parse(document.getElementById('demo-copy').textContent);
  function select(index) {
    scene.dataset.state = String(index);
    scene.setAttribute('aria-labelledby', tabs[index].id);
    tabs.forEach((tab, i) => { tab.setAttribute('aria-selected', String(i === index)); tab.tabIndex = i === index ? 0 : -1; });
    scene.querySelector('.demo-status').textContent = copy.status[index];
    scene.querySelector('.demo-message').textContent = copy.body[index];
    scene.querySelector('.demo-bubble').textContent = copy.bubble[index];
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(index));
    tab.addEventListener('keydown', event => {
      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
      if (next === null) return;
      event.preventDefault(); select(next); tabs[next].focus();
    });
  });
  scene.querySelector('.demo-return').addEventListener('click', () => {
    scene.querySelector('.demo-message').textContent = copy.opened;
    scene.querySelector('.demo-chat').classList.remove('just-returned');
    requestAnimationFrame(() => scene.querySelector('.demo-chat').classList.add('just-returned'));
  });
})();
