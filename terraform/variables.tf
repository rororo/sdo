variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "ap-northeast-1"
}

variable "project_name" {
  description = "Resource name prefix"
  type        = string
  default     = "excel-transformer"
}

variable "image_tag" {
  description = "Container image tag"
  type        = string
  default     = "latest"
}

variable "desired_count" {
  description = "Number of running ECS tasks"
  type        = number
  default     = 1
}

variable "allowed_ipv4_cidrs" {
  description = "IPv4 CIDRs allowed by the CloudFront WAF"
  type        = list(string)
}

variable "app_user" {
  description = "Application login username"
  type        = string
  sensitive   = true
}

variable "app_password" {
  description = "Application login password"
  type        = string
  sensitive   = true
}
