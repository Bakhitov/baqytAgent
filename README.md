# Baqyt Agent

## Wazzup Webhook Integration

- Set `WAZZUP_WEBHOOK_AUTH_TOKEN` in `.env` to require `Authorization: Bearer <token>` on inbound calls. Leave it blank to skip auth validation.
- Set `WAZZUP_API_TOKEN` to the API key that should be used when sending replies back through `POST https://api.wazzup24.com/v3/message`. Without this value outbound replies are skipped.
- Optionally override `WAZZUP_WEBHOOK_PATH` (defaults to `/webhooks/wazzup`) if your deployment requires a different URL.
- Set `WAZZUP_TARGET_CHAT_IDS` to a comma-separated list of chat IDs that should be handled. Defaults to `77066318623,77475318623`.
- Optionally override `WAZZUP_MESSAGE_API_URL` to point to a non-default Wazzup API host.
- Provide `OPENAI_API_KEY` so Mastra can transcribe аудио и описывать изображения из вебхуков.
- (Optional) Tune media models via `WAZZUP_TRANSCRIBE_MODEL` (default `gpt-4o-mini-transcribe`) and `WAZZUP_VISION_MODEL`. Отдельная vision-модель нужна только если основная не `gpt-5` — иначе используется `BAQYT_PRIMARY_MODEL_ID`.
- Аудиосообщения автоматически транскрибируются, изображения описываются моделью Vision; агент использует результат прямо в ответе.
- Deploy the service and register the webhook with Wazzup via `PATCH https://api.wazzup24.com/v3/webhooks` using the chosen URI and subscription flags.
- Wazzup sends a `{ "test": true }` payload during registration; the handler responds with HTTP 200 and `{ "ok": true }`.
- Webhook payloads are validated, normalized, and the resulting inbound messages are passed to the Baqyt agent with Mastra memory for the corresponding chat.
- Each generated reply is posted back to Wazzup in order via `POST ${WAZZUP_MESSAGE_API_URL}`. Replies are skipped when the agent returns no text.
