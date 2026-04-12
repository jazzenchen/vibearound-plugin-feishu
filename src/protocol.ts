/**
 * Feishu plugin configuration — passed from host settings.json via ACP initialize.
 */

export interface FeishuConfig {
  app_id: string;
  app_secret: string;
  domain?: "feishu" | "lark";
  encrypt_key?: string;
  verification_token?: string;
}
