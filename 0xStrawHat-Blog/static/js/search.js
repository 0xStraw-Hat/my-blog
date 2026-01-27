document.addEventListener('DOMContentLoaded', function () {
  const searchInputWrapper = document.getElementById('reimu-search-input');
  const searchInput = searchInputWrapper ? searchInputWrapper.querySelector('input') : null;
  const searchResults = document.getElementById('reimu-hits');
  const searchStats = document.getElementById('reimu-stats');
  const popupBtnClose = document.querySelector('.popup-btn-close');
  const popup = document.querySelector('.reimu-popup');
  const siteSearch = document.querySelector('.site-search');
  const navSearchBtn = document.getElementById('nav-search-btn');
  const pagination = document.getElementById('reimu-pagination');

  let searchIndex = [];

  if (!searchInput || !searchResults) return;

  // Toggle Popup
  if(navSearchBtn) {
      navSearchBtn.addEventListener('click', () => {
          document.body.style.overflow = 'hidden';
          if(siteSearch) siteSearch.style.display = 'block';
          setTimeout(() => {
             if(popup) popup.classList.add('show');
             searchInput.focus(); 
          }, 100);
          
          if (searchIndex.length === 0) {
              fetch('/index.json')
                  .then(response => response.json())
                  .then(data => {
                      searchIndex = data;
                  })
                  .catch(error => console.error('Error fetching search index:', error));
          }
      });
  }

  const closeSearch = () => {
      if(popup) popup.classList.remove('show');
      setTimeout(() => {
          if(siteSearch) siteSearch.style.display = 'none';
          document.body.style.overflow = 'auto';
      }, 300);
  };

  if(popupBtnClose) popupBtnClose.addEventListener('click', closeSearch);
  if(siteSearch) siteSearch.addEventListener('click', (e) => {
      if(e.target === siteSearch) closeSearch();
  });
    document.addEventListener('click', (e) => {
      if(!popup || !popup.classList.contains('show')) return;
      if(navSearchBtn && navSearchBtn.contains(e.target)) return;
      if(popup.contains(e.target)) return;
      closeSearch();
    });

  searchInput.addEventListener('input', function () {
    const query = this.value.toLowerCase();
    searchResults.innerHTML = '';
    searchStats.innerHTML = '';
    if(pagination) pagination.innerHTML = '';

    if (query.length < 2) return;

    const startTime = performance.now();

    const results = searchIndex.filter(item => {
      const title = item.title ? item.title.toLowerCase() : '';
      const content = item.content ? item.content.toLowerCase() : '';
      const categories = item.categories ? item.categories.join(' ').toLowerCase() : '';
      const tags = item.tags ? item.tags.join(' ').toLowerCase() : '';

      return title.includes(query) || content.includes(query) || categories.includes(query) || tags.includes(query);
    });
    
    const endTime = performance.now();
    const timeTaken = Math.round(endTime - startTime);

    searchStats.innerHTML = `Found ${results.length} results (in ${timeTaken} ms)`;

    results.forEach(item => {
      const div = document.createElement('div');
      div.className = 'reimu-hit-item';
      div.innerHTML = `
        <a href="${item.permalink}" class="reimu-hit-item-link">
            <span class="reimu-hit-marker"></span>
            <div class="reimu-hit-content-wrapper">
                <h3 class="reimu-hit-item-title">${item.title}</h3>
            </div>
        </a>
      `;
      searchResults.appendChild(div);
    });
  });
});
