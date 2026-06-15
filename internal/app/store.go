package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
)

type Store struct {
	dir              string
	mu               sync.RWMutex
	accountsCache    []Account
	authKeysCache    []UserKey
	inviteCodesCache []InviteCode
	usersCache       []LocalUser
	cacheLoaded      bool
}

func NewStore(dir string) *Store {
	_ = os.MkdirAll(dir, 0755)
	s := &Store{dir: dir}
	s.loadAllToCache()
	return s
}

func (s *Store) loadAllToCache() {
	s.mu.Lock()
	defer s.mu.Unlock()

	// load accounts
	accounts := readJSONFile(s.path("accounts.json"), []Account{})
	s.accountsCache = make([]Account, 0, len(accounts))
	for _, a := range accounts {
		if a.AccessToken == "" {
			continue
		}
		if a.Type == "" {
			a.Type = "free"
		}
		if a.Status == "" {
			a.Status = "正常"
		}
		if a.SourceType == "" {
			a.SourceType = "web"
		}
		if a.InitialQuota < a.Quota {
			a.InitialQuota = a.Quota
		}
		s.accountsCache = append(s.accountsCache, a)
	}

	// load auth keys
	path := s.path("auth_keys.json")
	wrap := readJSONFile(path, authKeysWrap{})
	if len(wrap.Items) > 0 {
		s.authKeysCache = normalizeKeys(wrap.Items)
	} else {
		arr := readJSONFile(path, []UserKey{})
		s.authKeysCache = normalizeKeys(arr)
	}

	// load invite codes
	s.inviteCodesCache = readJSONFile(s.path("invite_codes.json"), []InviteCode{})

	// load users
	s.usersCache = readJSONFile(s.path("users.json"), []LocalUser{})

	s.cacheLoaded = true
}

func (s *Store) path(name string) string { return filepath.Join(s.dir, name) }

func readJSONFile[T any](path string, fallback T) T {
	b, err := os.ReadFile(path)
	if err != nil {
		return fallback
	}
	var out T
	if err := json.Unmarshal(b, &out); err != nil {
		return fallback
	}
	return out
}

func writeJSONFile(path string, value any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	b = append(b, '\n')
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func (s *Store) LoadAccounts() []Account {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Account, len(s.accountsCache))
	copy(out, s.accountsCache)
	return out
}

func (s *Store) SaveAccounts(items []Account) error {
	s.mu.Lock()
	s.accountsCache = make([]Account, len(items))
	copy(s.accountsCache, items)
	s.mu.Unlock()

	s.mu.Lock()
	defer s.mu.Unlock()
	return writeJSONFile(s.path("accounts.json"), items)
}

type authKeysWrap struct {
	Items []UserKey `json:"items"`
}

func (s *Store) LoadAuthKeys() []UserKey {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]UserKey, len(s.authKeysCache))
	copy(out, s.authKeysCache)
	return out
}

func (s *Store) SaveAuthKeys(items []UserKey) error {
	s.mu.Lock()
	s.authKeysCache = make([]UserKey, len(items))
	copy(s.authKeysCache, items)
	s.mu.Unlock()

	s.mu.Lock()
	defer s.mu.Unlock()
	return writeJSONFile(s.path("auth_keys.json"), authKeysWrap{Items: items})
}

func (s *Store) UpdateAuthKeysCacheOnly(items []UserKey) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.authKeysCache = make([]UserKey, len(items))
	copy(s.authKeysCache, items)
}

func (s *Store) LoadInviteCodes() []InviteCode {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]InviteCode, len(s.inviteCodesCache))
	copy(out, s.inviteCodesCache)
	return out
}

func (s *Store) SaveInviteCodes(items []InviteCode) error {
	s.mu.Lock()
	s.inviteCodesCache = make([]InviteCode, len(items))
	copy(s.inviteCodesCache, items)
	s.mu.Unlock()

	s.mu.Lock()
	defer s.mu.Unlock()
	return writeJSONFile(s.path("invite_codes.json"), items)
}

func (s *Store) LoadUsers() []LocalUser {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]LocalUser, len(s.usersCache))
	copy(out, s.usersCache)
	return out
}

func (s *Store) SaveUsers(items []LocalUser) error {
	s.mu.Lock()
	s.usersCache = make([]LocalUser, len(items))
	copy(s.usersCache, items)
	s.mu.Unlock()

	s.mu.Lock()
	defer s.mu.Unlock()
	return writeJSONFile(s.path("users.json"), items)
}

func (s *Store) LoadGallery() []GalleryItem {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readJSONFile(s.path("gallery.json"), []GalleryItem{})
}
func (s *Store) SaveGallery(items []GalleryItem) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return writeJSONFile(s.path("gallery.json"), items)
}
func (s *Store) LoadLogs() []LogItem {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readJSONFile(s.path("logs.json"), []LogItem{})
}
func (s *Store) SaveLogs(items []LogItem) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return writeJSONFile(s.path("logs.json"), items)
}
func (s *Store) LoadTasks() []ImageTask {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readJSONFile(s.path("image_tasks.json"), []ImageTask{})
}
func (s *Store) SaveTasks(items []ImageTask) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return writeJSONFile(s.path("image_tasks.json"), items)
}
func (s *Store) LoadOwners() map[string]string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readJSONFile(s.path("image_owners.json"), map[string]string{})
}
func (s *Store) SaveOwners(items map[string]string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return writeJSONFile(s.path("image_owners.json"), items)
}
func (s *Store) LoadPrompts() map[string]map[string]any {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readJSONFile(s.path("image_prompts.json"), map[string]map[string]any{})
}
func (s *Store) SavePrompts(items map[string]map[string]any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return writeJSONFile(s.path("image_prompts.json"), items)
}
func (s *Store) LoadTags() map[string][]string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readJSONFile(s.path("image_tags.json"), map[string][]string{})
}
func (s *Store) SaveTags(items map[string][]string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return writeJSONFile(s.path("image_tags.json"), items)
}
func (s *Store) LoadList(name string) []map[string]any {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readJSONFile(s.path(name), []map[string]any{})
}
func (s *Store) SaveList(name string, v []map[string]any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return writeJSONFile(s.path(name), v)
}

func ensureNotDir(path string) error {
	st, err := os.Stat(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if st.IsDir() {
		return errors.New(path + " is a directory")
	}
	return nil
}

func hashKey(key string) string { h := sha256.Sum256([]byte(key)); return hex.EncodeToString(h[:]) }
