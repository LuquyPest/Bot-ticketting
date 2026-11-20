# High availability (v7): two bot containers, the active one gets the traffic (/api/health/ready
# answers 200 on it, 503 on the standby). PUBLIC_HOST and ACME_EMAIL come from .env.
{
	email {$ACME_EMAIL}
}

{$PUBLIC_HOST} {
	encode zstd gzip
	reverse_proxy bot:3000 bot-standby:3000 {
		lb_policy first
		health_uri /api/health/ready
		health_interval 5s
		health_timeout 3s
		fail_duration 10s
		# Real-time stream (SSE): nothing buffered
		flush_interval -1
	}
}
