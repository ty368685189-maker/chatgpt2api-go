package app

import (
	"net/http"
	"strings"
)

// Image conversation handlers - server-side storage for multi-device sync

func (s *Server) handleImageConversations(w http.ResponseWriter, r *http.Request) {
	identity, ok := s.requireIdentity(w, r)
	if !ok {
		return
	}
	if r.Method == http.MethodGet {
		items := []map[string]any{}
		for _, it := range s.store.LoadList("image_conversations.json") {
			if strAny(it["owner_id"], identity.ID) == identity.ID || identity.Role == "admin" {
				items = append(items, it)
			}
		}
		writeJSON(w, 200, map[string]any{"items": items})
		return
	}
	if r.Method == http.MethodPost {
		var b map[string]any
		if !readBody(w, r, &b) {
			return
		}
		if strings.TrimSpace(strAny(b["id"], "")) == "" {
			b["id"] = "imgconv_" + randID(8)
		}
		b["owner_id"] = identity.ID
		b["updated_at"] = nowISO()
		if strings.TrimSpace(strAny(b["created_at"], "")) == "" {
			b["created_at"] = nowISO()
		}
		items := s.store.LoadList("image_conversations.json")
		out := []map[string]any{b}
		for _, it := range items {
			if strAny(it["id"], "") != strAny(b["id"], "") {
				out = append(out, it)
			}
		}
		_ = s.store.SaveList("image_conversations.json", out)
		writeJSON(w, 200, map[string]any{"item": b})
		return
	}
	writeErr(w, 405, "method not allowed")
}

func (s *Server) handleImageConversationID(w http.ResponseWriter, r *http.Request) {
	identity, ok := s.requireIdentity(w, r)
	if !ok {
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/api/image/conversations/")
	items := s.store.LoadList("image_conversations.json")

	if r.Method == http.MethodDelete {
		out := []map[string]any{}
		for _, it := range items {
			if strAny(it["id"], "") != id {
				out = append(out, it)
			}
		}
		_ = s.store.SaveList("image_conversations.json", out)
		writeJSON(w, 200, map[string]any{"ok": true})
		return
	}

	if r.Method == http.MethodGet {
		for _, it := range items {
			if strAny(it["id"], "") == id {
				owner := strAny(it["owner_id"], "")
				if owner == "" || owner == identity.ID || identity.Role == "admin" {
					writeJSON(w, 200, map[string]any{"item": it})
					return
				}
			}
		}
		writeErr(w, 404, "not found")
		return
	}

	writeErr(w, 405, "method not allowed")
}
