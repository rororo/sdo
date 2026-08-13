resource "aws_secretsmanager_secret" "app_auth" {
  name                    = "${var.project_name}/auth"
  description             = "Application login username and password hash"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "app_auth" {
  secret_id = aws_secretsmanager_secret.app_auth.id
  secret_string = jsonencode({
    APP_USER          = var.app_user
    APP_PASSWORD_HASH = var.app_password_hash
  })
}
