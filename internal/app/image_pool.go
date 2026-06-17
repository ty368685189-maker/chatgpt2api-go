package app

import (
	"context"
	"errors"
	"strings"
	"time"
)

func (s *Server) generateImageWithPool(ctx context.Context, prompt, model, size, resolution string, refs [][]byte) ([]upstreamImageResult, error) {
	accounts := s.store.LoadAccounts()
	maxAttempts := len(accounts)
	if maxAttempts < 1 {
		maxAttempts = 1
	}
	// 生图最多重试 3 个账号，避免 15 个号在几秒内全被封
	if maxAttempts > 3 {
		maxAttempts = 3
	}
	excluded := map[string]bool{}
	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		traceLogf(ctx, "├─ image account attempt %d/%d model=%s resolution=%s excluded=%d", attempt+1, maxAttempts, model, resolution, len(excluded))
		account, err := s.pickAccountExcluding(model, resolution, excluded)
		if err != nil {
			if lastErr != nil {
				return nil, lastErr
			}
			return nil, err
		}
		token := account.AccessToken
		client, err := s.upstreamClientForImageAccount(model, resolution, account)
		if err != nil {
			s.accountPool.releaseToken(token)
			if lastErr != nil {
				return nil, lastErr
			}
			return nil, err
		}
		// Inject server bootstrap cache
		client.cacheRef = s.bootstrap
		if ss, db, crt, sot, ok := s.bootstrap.Get(token); ok {
			client.SetBootstrapCache(ss, db, crt, sot)
		}
		traceLogf(ctx, "│  ├─ selected image account %s", accountLabel(account))
		excluded[token] = true
		items, err := client.GenerateImage(ctx, prompt, model, size, resolution, refs)
		s.accountPool.releaseToken(token)
		if err == nil {
			traceLogf(ctx, "└─ image account attempt %d success images=%d", attempt+1, len(items))
			s.markAccountSuccess(token, true)
			return items, nil
		}
		traceLogf(ctx, "│  └─ image account attempt %d failed error=%v", attempt+1, err)
		s.markAccountFailure(token, err, true)
		lastErr = err
		if !shouldRetryImageAccount(err) {
			return nil, err
		}
		// Unusual activity 是 IP 级封禁，换号没用，直接返回
		if isUpstreamBlockErrorText(err) {
			traceLogf(ctx, "└─ image: upstream block detected (IP-level), stop retrying")
			return nil, err
		}
		// 重试前等待，避免短时间内大量请求触发风控
		if attempt < maxAttempts-1 {
			delay := time.Duration(2+attempt*2) * time.Second // 2s, 4s 递增
			traceLogf(ctx, "│  ├─ waiting %v before retry", delay)
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(delay):
			}
		}
		traceLogf(ctx, "│  ├─ retry with another image account")
	}
	if lastErr == nil {
		lastErr = errors.New("no available image quota")
	}
	return nil, lastErr
}

func shouldRetryImageAccount(err error) bool {
	if err == nil {
		return false
	}
	// Unusual activity (403) 不重试——IP 级封禁，换号没用
	if isUpstreamBlockErrorText(err) {
		text := strings.ToLower(err.Error())
		if strings.Contains(text, "unusual activity") {
			return false
		}
	}
	return isRateLimitErrorText(err) || isInvalidTokenErrorText(err) || isUpstreamBlockErrorText(err) || isTurnstileRequirementErrorText(err)
}
