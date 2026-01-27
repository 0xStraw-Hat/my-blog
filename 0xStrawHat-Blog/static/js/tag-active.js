document.addEventListener('DOMContentLoaded', () => {
  const normalize = (path) => `${path.replace(/\/+$/, '')}/`;
  const currentPath = normalize(window.location.pathname);

  const applyActive = (selector, scopePrefix) => {
    if (!currentPath.startsWith(scopePrefix)) return;
    const links = document.querySelectorAll(selector);
    if (!links.length) return;

    links.forEach((link) => {
      const href = link.getAttribute('href') || '';
      if (!href) return;
      const linkPath = normalize(new URL(href, window.location.origin).pathname);
      if (currentPath === linkPath) {
        link.classList.add('active');
        link.parentElement?.classList.add('active');
        link.setAttribute('aria-current', 'page');
      }
    });
  };

  applyActive('.archives-tag-list-link', '/tags/');
  applyActive('.archives-category-list-link', '/categories/');
});
