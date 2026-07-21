package service

import (
	"errors"
	"testing"
	"time"

	"github.com/kleinai/backend/internal/model"
	"github.com/kleinai/backend/internal/provider"
)

func TestProviderCooldownGrokForbiddenIsTransient(t *testing.T) {
	err := errors.New(`grok upload HTTP 403: <!DOCTYPE html><html><head><title>Just a moment...</title></head></html>`)
	if got := providerCooldown(err); got != 0 {
		t.Fatalf("expected transient cooldown 0, got %s", got)
	}
}

func TestProviderCooldownRetryable429StillCooldowns(t *testing.T) {
	err := errors.New(`provider call: grok video HTTP 429: {"error":{"code":8,"message":"Too many requests"}}`)
	got := providerCooldown(err)
	if got < 30*time.Minute {
		t.Fatalf("expected 429 cooldown >= 30m, got %s", got)
	}
}

func TestRetryableProviderErrorCockpitEmptyPool(t *testing.T) {
	err := errors.New(`provider call: gpt image2 503: {"error":"free 号池暂无账号"}`)
	if !retryableProviderError(err) {
		t.Fatal("expected cockpit empty pool error to retry with another gateway account")
	}
}

func TestRetryableProviderErrorCockpitImageToolUnavailable(t *testing.T) {
	err := errors.New(`provider call: gpt image2 503: {"error":"当前账号未开放 image_generation 工具，不能用该号池原生生成 gpt-image-2"}`)
	if !retryableProviderError(err) {
		t.Fatal("expected cockpit image tool unavailable error to retry with another gateway account")
	}
}

func TestRetryableProviderErrorGPTImageWebArkose(t *testing.T) {
	err := errors.New(`provider call: gpt image2 web requires arkose`)
	if !retryableProviderError(err) {
		t.Fatal("expected gpt image2 web arkose error to retry with another web account")
	}
}

func TestRetryableProviderErrorOAuthRefreshTimeout(t *testing.T) {
	err := errors.New(`provider call: refresh OAuth access_token failed: OpenAI 刷新请求失败: Post "https://auth.openai.com/oauth/token": i/o timeout`)
	if !retryableProviderError(err) {
		t.Fatal("expected oauth refresh timeout to retry with another account")
	}
}

func TestGPTImageFreeWebAccountPredicate(t *testing.T) {
	meta := `{"plan_type":"free","client_id":"app_EMoamEEZ73f0CkXaXp7hrann"}`
	acc := &model.Account{
		Provider:  model.ProviderGPT,
		AuthType:  model.AuthTypeOAuth,
		OAuthMeta: &meta,
	}
	if !isGPTImageFreeWebAccount(acc) {
		t.Fatal("expected free oauth account without base_url to be a free web account")
	}
}

func TestShouldUseGPTImageWebCredential(t *testing.T) {
	acc := &model.Account{Provider: model.ProviderGPT, AuthType: model.AuthTypeOAuth}
	req := &provider.Request{
		Kind:      provider.KindImage,
		ModelCode: "gpt-image-2",
		Params:    map[string]any{"resolution": "1K"},
		Account:   acc,
	}
	if !shouldUseGPTImageWebCredential(req) {
		t.Fatal("expected low-res gpt-image-2 oauth request to use web credential path")
	}
}
