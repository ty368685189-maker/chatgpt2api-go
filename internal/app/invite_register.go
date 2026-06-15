package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode"
)

// ── 邀请码管理 API（admin） ──

func (s *Server) handleInviteCodes(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		items := s.store.LoadInviteCodes()
		public := make([]map[string]any, 0, len(items))
		for _, ic := range items {
			public = append(public, inviteCodePublic(ic))
		}
		writeJSON(w, 200, map[string]any{"items": public})

	case http.MethodPost:
		var body map[string]any
		if !readBody(w, r, &body) {
			return
		}
		code := strings.TrimSpace(strAny(body["code"], ""))
		if code == "" {
			code = "INV-" + strings.ToUpper(randID(8))
		}
		maxUses := intAny(body["max_uses"], 100)
		if maxUses < 1 {
			maxUses = 1
		}
		ic := InviteCode{
			ID:                    randID(8),
			Code:                  code,
			CreatedAt:             nowISO(),
			MaxUses:               maxUses,
			UsedCount:             0,
			AccountTier:           strAny(body["account_tier"], "free"),
			ImageDailyQuota:       intAny(body["image_daily_quota"], 10),
			ImageDailyUnlimited:   boolAny(body["image_daily_unlimited"], false),
			ImageMonthlyQuota:     intAny(body["image_monthly_quota"], 310),
			ImageMonthlyUnlimited: boolAny(body["image_monthly_unlimited"], false),
			ImageTotalQuota:       intAny(body["image_total_quota"], 0),
			ImageTotalUnlimited:   boolAny(body["image_total_unlimited"], true),
			ChatDailyQuota:        intAny(body["chat_daily_quota"], 0),
			ChatDailyUnlimited:    boolAny(body["chat_daily_unlimited"], true),
			ChatMonthlyQuota:      intAny(body["chat_monthly_quota"], 0),
			ChatMonthlyUnlimited:  boolAny(body["chat_monthly_unlimited"], true),
			ChatTotalQuota:        intAny(body["chat_total_quota"], 0),
			ChatTotalUnlimited:    boolAny(body["chat_total_unlimited"], true),
		}
		s.authMu.Lock()
		items := s.store.LoadInviteCodes()
		items = append(items, ic)
		_ = s.store.SaveInviteCodes(items)
		s.authMu.Unlock()
		public := make([]map[string]any, 0, len(items))
		for _, it := range items {
			public = append(public, inviteCodePublic(it))
		}
		writeJSON(w, 200, map[string]any{"item": inviteCodePublic(ic), "items": public})

	default:
		writeErr(w, 405, "method not allowed")
	}
}

func (s *Server) handleInviteCodeID(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/api/invite-codes/")
	id = strings.Trim(id, "/")
	if id == "" {
		writeErr(w, 404, "not found")
		return
	}
	s.authMu.Lock()
	defer s.authMu.Unlock()
	items := s.store.LoadInviteCodes()
	idx := -1
	for i, ic := range items {
		if ic.ID == id {
			idx = i
			break
		}
	}
	if idx < 0 {
		writeErr(w, 404, "邀请码不存在")
		return
	}
	switch r.Method {
	case http.MethodDelete:
		items = append(items[:idx], items[idx+1:]...)
		_ = s.store.SaveInviteCodes(items)
		public := make([]map[string]any, 0, len(items))
		for _, it := range items {
			public = append(public, inviteCodePublic(it))
		}
		writeJSON(w, 200, map[string]any{"items": public})
	default:
		writeErr(w, 405, "method not allowed")
	}
}

func inviteCodePublic(ic InviteCode) map[string]any {
	return map[string]any{
		"id":                     ic.ID,
		"code":                   ic.Code,
		"created_at":             ic.CreatedAt,
		"max_uses":               ic.MaxUses,
		"used_count":             ic.UsedCount,
		"account_tier":           ic.AccountTier,
		"image_daily_quota":      ic.ImageDailyQuota,
		"image_daily_unlimited":  ic.ImageDailyUnlimited,
		"image_monthly_quota":    ic.ImageMonthlyQuota,
		"image_monthly_unlimited": ic.ImageMonthlyUnlimited,
		"image_total_quota":      ic.ImageTotalQuota,
		"image_total_unlimited":  ic.ImageTotalUnlimited,
		"chat_daily_quota":       ic.ChatDailyQuota,
		"chat_daily_unlimited":   ic.ChatDailyUnlimited,
		"chat_monthly_quota":     ic.ChatMonthlyQuota,
		"chat_monthly_unlimited": ic.ChatMonthlyUnlimited,
		"chat_total_quota":       ic.ChatTotalQuota,
		"chat_total_unlimited":   ic.ChatTotalUnlimited,
	}
}

// ── 用户注册 API（公开） ──

type registerRequest struct {
	Username   string `json:"username"`
	Password   string `json:"password"`
	InviteCode     string `json:"invite_code"`
	TurnstileToken string `json:"turnstile_token,omitempty"`
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "method not allowed")
		return
	}
	var body registerRequest
	if !readBody(w, r, &body) {
		return
	}
	body.Username = strings.TrimSpace(body.Username)
	body.Password = strings.TrimSpace(body.Password)
	body.InviteCode = strings.TrimSpace(body.InviteCode)

	if body.Username == "" || body.Password == "" {
		writeErr(w, 400, "用户名和密码不能为空")
		return
	}
	runes := []rune(body.Username)
	if len(runes) < 2 || len(runes) > 16 {
		writeErr(w, 400, "用户名长度必须为 2 到 16 个字符")
		return
	}
	for _, r := range runes {
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '_' {
			writeErr(w, 400, "用户名只能包含中文、英文、数字或下划线")
			return
		}
	}
	if len(body.Password) < 6 {
		writeErr(w, 400, "密码至少 6 个字符")
		return
	}
	if body.InviteCode == "" {
		writeErr(w, 400, "邀请码不能为空")
		return
	}

	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		ip = r.RemoteAddr
	}
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		ip = strings.Split(fwd, ",")[0]
	}
	today := time.Now().Format("2006-01-02")
	s.authMu.Lock()
	if s.ipRegDates[ip] != today {
		s.ipRegDates[ip] = today
		s.ipRegCounts[ip] = 0
	}
	if s.ipRegCounts[ip] >= 3 {
		s.authMu.Unlock()
		writeErr(w, 429, "当前 IP 注册次数过多，请明日再试")
		return
	}
	s.authMu.Unlock()

	if s.cfg.TurnstileSecretKey != "" {
		if body.TurnstileToken == "" {
			writeErr(w, 400, "缺少人机验证令牌")
			return
		}
		data := url.Values{"secret": {s.cfg.TurnstileSecretKey}, "response": {body.TurnstileToken}}
		resp, err := http.PostForm("https://challenges.cloudflare.com/turnstile/v0/siteverify", data)
		if err != nil {
			writeErr(w, 500, "验证服务不可用")
			return
		}
		defer resp.Body.Close()
		var res map[string]any
		json.NewDecoder(resp.Body).Decode(&res)
		if success, _ := res["success"].(bool); !success {
			writeErr(w, 400, "人机验证失败，请刷新重试")
			return
		}
	}

	// 验证邀请码
	s.authMu.Lock()
	defer s.authMu.Unlock()
	inviteCodes := s.store.LoadInviteCodes()
	icIdx := -1
	for i, ic := range inviteCodes {
		if ic.Code == body.InviteCode {
			icIdx = i
			break
		}
	}
	if icIdx < 0 {
		writeErr(w, 400, "邀请码无效")
		return
	}
	ic := inviteCodes[icIdx]
	if ic.UsedCount >= ic.MaxUses {
		writeErr(w, 400, "邀请码已用完")
		return
	}

	// 检查用户名重复
	users := s.store.LoadUsers()
	for _, u := range users {
		if u.Username == body.Username {
			writeErr(w, 409, "用户名已被占用")
			return
		}
	}

	// 生成密码哈希
	salt := randID(16)
	pwHash := sha256.Sum256([]byte(body.Password + salt))
	pwHashHex := hex.EncodeToString(pwHash[:])

	// 创建 API Key
	rawKey := "sk-" + randID(24)
	keyID := randID(6)

	// 创建 UserKey
	k := UserKey{
		ID:                    keyID,
		Name:                  "auto_" + body.Username,
		Role:                  "user",
		KeyHash:               hashKey(rawKey),
		Key:                   rawKey,
		AccountTier:           ic.AccountTier,
		Enabled:               true,
		CreatedAt:             nowISO(),
		ImageDailyQuota:       ic.ImageDailyQuota,
		ImageDailyUnlimited:   ic.ImageDailyUnlimited,
		ImageMonthlyQuota:     ic.ImageMonthlyQuota,
		ImageMonthlyUnlimited: ic.ImageMonthlyUnlimited,
		ImageTotalQuota:       ic.ImageTotalQuota,
		ImageTotalUnlimited:   ic.ImageTotalUnlimited,
		ChatDailyQuota:        ic.ChatDailyQuota,
		ChatDailyUnlimited:    ic.ChatDailyUnlimited,
		ChatMonthlyQuota:      ic.ChatMonthlyQuota,
		ChatMonthlyUnlimited:  ic.ChatMonthlyUnlimited,
		ChatTotalQuota:        ic.ChatTotalQuota,
		ChatTotalUnlimited:    ic.ChatTotalUnlimited,
		ImageDailyResetAt:     todayKey(),
		ImageMonthlyResetAt:   monthKey(),
		ChatDailyResetAt:      todayKey(),
		ChatMonthlyResetAt:    monthKey(),
	}
	keys := s.store.LoadAuthKeys()
	keys = append(keys, k)
	_ = s.store.SaveAuthKeys(keys)

	// 创建本地用户
	user := LocalUser{
		ID:           randID(8),
		Username:     body.Username,
		PasswordHash: pwHashHex,
		PasswordSalt: salt,
		BoundKeyID:   keyID,
		BoundRawKey:  rawKey,
		CreatedAt:    nowISO(),
	}
	users = append(users, user)
	_ = s.store.SaveUsers(users)

	// 邀请码用量+1
	inviteCodes[icIdx].UsedCount++
	_ = s.store.SaveInviteCodes(inviteCodes)

	s.ipRegCounts[ip]++

	writeJSON(w, 200, map[string]any{
		"ok":     true,
		"key":    rawKey,
		"name":   user.Username,
		"user_id": user.ID,
	})
}

// ── 用户密码登录 API ──

type loginPasswordRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (s *Server) handleLoginPassword(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "method not allowed")
		return
	}
	var body loginPasswordRequest
	if !readBody(w, r, &body) {
		return
	}
	body.Username = strings.TrimSpace(body.Username)
	body.Password = strings.TrimSpace(body.Password)

	if body.Username == "" || body.Password == "" {
		writeErr(w, 400, "用户名和密码不能为空")
		return
	}

	users := s.store.LoadUsers()
	for _, u := range users {
		if u.Username != body.Username {
			continue
		}
		pwHash := sha256.Sum256([]byte(body.Password + u.PasswordSalt))
		pwHashHex := hex.EncodeToString(pwHash[:])
		if pwHashHex != u.PasswordHash {
			writeErr(w, 401, "密码错误")
			return
		}
		keys := s.store.LoadAuthKeys()
		keyEnabled := false
		for _, k := range keys {
			if k.ID == u.BoundKeyID {
				if k.Enabled {
					keyEnabled = true
				}
				break
			}
		}
		if !keyEnabled {
			writeErr(w, 401, "该账户已被管理员禁用或删除")
			return
		}

		writeJSON(w, 200, map[string]any{
			"ok":           true,
			"bound_raw_key": u.BoundRawKey,
			"name":         u.Username,
			"user_id":      u.ID,
		})
		return
	}
	writeErr(w, 401, "用户不存在")
}

// ── 用户列表 API（admin） ──

func (s *Server) handleLocalUsers(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	if r.Method != http.MethodGet {
		writeErr(w, 405, "method not allowed")
		return
	}
	users := s.store.LoadUsers()
	items := make([]map[string]any, 0, len(users))
	for _, u := range users {
		items = append(items, map[string]any{
			"id":            u.ID,
			"username":      u.Username,
			"bound_key_id":  u.BoundKeyID,
			"created_at":    u.CreatedAt,
		})
	}
	writeJSON(w, 200, map[string]any{"items": items})
}
