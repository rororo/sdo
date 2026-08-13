resource "aws_wafv2_ip_set" "allowed" {
  provider           = aws.us_east_1
  name               = "${var.project_name}-allowed-ipv4"
  scope              = "CLOUDFRONT"
  ip_address_version = "IPV4"
  addresses          = var.allowed_ipv4_cidrs
}

resource "aws_wafv2_web_acl" "app" {
  provider = aws.us_east_1
  name     = "${var.project_name}-web-acl"
  scope    = "CLOUDFRONT"

  default_action {
    block {}
  }

  rule {
    name     = "allow-listed-ipv4"
    priority = 1
    action {
      allow {}
    }
    statement {
      ip_set_reference_statement {
        arn = aws_wafv2_ip_set.allowed.arn
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project_name}-allowed-ipv4"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.project_name}-web-acl"
    sampled_requests_enabled   = true
  }
}

resource "aws_cloudfront_distribution" "app" {
  enabled         = true
  comment         = var.project_name
  price_class     = "PriceClass_200"
  http_version    = "http2and3"
  is_ipv6_enabled = true
  # IP restriction is temporarily disabled. Restore this association to enable it again.
  # web_acl_id = aws_wafv2_web_acl.app.arn

  origin {
    domain_name = aws_lb.app.dns_name
    origin_id   = "alb-origin"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 120
    }

    custom_header {
      name  = "X-Origin-Verify"
      value = random_password.origin_secret.result
    }
  }

  default_cache_behavior {
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD"]
    target_origin_id         = "alb-origin"
    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
    viewer_protocol_policy   = "redirect-to-https"
    compress                 = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}
