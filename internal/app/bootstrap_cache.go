package app

import (
	"sync"
	"time"
)

// bootstrapCacheEntry caches per-account bootstrap data to avoid re-fetching
// the ChatGPT home page on every image generation request.
type bootstrapCacheEntry struct {
	scriptSources []string
	dataBuild     string
	crToken       string
	crSOToken     string
	cachedAt      time.Time
}

type bootstrapCache struct {
	mu      sync.RWMutex
	entries map[string]*bootstrapCacheEntry // key = account token prefix (first 16 chars)
	ttl     time.Duration
}

func newBootstrapCache(ttl time.Duration) *bootstrapCache {
	return &bootstrapCache{
		entries: make(map[string]*bootstrapCacheEntry),
		ttl:     ttl,
	}
}

func (c *bootstrapCache) cacheKey(token string) string {
	if len(token) > 16 {
		return token[:16]
	}
	return token
}

func (c *bootstrapCache) Get(token string) (scriptSources []string, dataBuild, crToken, crSOToken string, ok bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	entry, exists := c.entries[c.cacheKey(token)]
	if !exists {
		return nil, "", "", "", false
	}
	if time.Since(entry.cachedAt) > c.ttl {
		return nil, "", "", "", false
	}
	return entry.scriptSources, entry.dataBuild, entry.crToken, entry.crSOToken, true
}

func (c *bootstrapCache) Set(token string, scriptSources []string, dataBuild, crToken, crSOToken string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[c.cacheKey(token)] = &bootstrapCacheEntry{
		scriptSources: scriptSources,
		dataBuild:     dataBuild,
		crToken:       crToken,
		crSOToken:     crSOToken,
		cachedAt:      time.Now(),
	}
}

func (c *bootstrapCache) Cleanup() {
	c.mu.Lock()
	defer c.mu.Unlock()
	for k, v := range c.entries {
		if time.Since(v.cachedAt) > c.ttl*2 {
			delete(c.entries, k)
		}
	}
}
