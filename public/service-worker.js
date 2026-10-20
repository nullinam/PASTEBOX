const CACHE = 'pastebox-shell-v1'
const SCOPE = new URL(self.registration.scope)

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add(new URL('index.html', SCOPE).href)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('pastebox-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method === 'POST' && url.origin === SCOPE.origin && url.pathname === new URL('share-target', SCOPE).pathname) {
    event.respondWith((async () => {
      try {
        const form = await request.formData()
        const incoming = form.getAll('file').filter(file => file instanceof File)
        if (!incoming.length) return Response.redirect(SCOPE.href, 303)
        const db = await new Promise((resolve, reject) => {
          const open = indexedDB.open('pastebox-inbox', 1)
          open.onupgradeneeded = () => open.result.createObjectStore('files', { keyPath: 'id' })
          open.onsuccess = () => resolve(open.result)
          open.onerror = () => reject(open.error)
        })
        await new Promise((resolve, reject) => {
          const transaction = db.transaction('files', 'readwrite')
          incoming.forEach(file => transaction.objectStore('files').put({ id: crypto.randomUUID(), file }))
          transaction.oncomplete = resolve
          transaction.onerror = () => reject(transaction.error)
        })
        db.close()
        return Response.redirect(`${SCOPE.href}?receive=1`, 303)
      } catch {
        return Response.redirect(SCOPE.href, 303)
      }
    })())
    return
  }
  if (request.method !== 'GET' || url.origin !== SCOPE.origin) return
  if (url.pathname.startsWith(new URL('functions/', SCOPE).pathname)) return
  if (url.pathname === SCOPE.pathname || url.pathname === `${SCOPE.pathname}index.html`) {
    event.respondWith(fetch(request).catch(async () => (await caches.match(new URL('index.html', SCOPE).href)) || Response.error()))
    return
  }
  if (url.pathname.startsWith(new URL('assets/', SCOPE).pathname)) {
    event.respondWith(caches.open(CACHE).then(async cache => {
      const cached = await cache.match(request)
      const network = fetch(request).then(response => {
        if (response.ok && response.type === 'basic') cache.put(request, response.clone())
        return response
      })
      return cached || network
    }))
  }
})
