module.exports = {
    redis_host: process.env.REDIS_HOST != null ? process.env.REDIS_HOST : '127.0.0.1',
    redis_port: process.env.REDIS_PORT != null ? process.env.REDIS_PORT : 6379,
    web_host: process.env.WEB_HOST != null ? process.env.WEB_HOST : 'http://127.0.0.1',
    web_port: process.env.WEB_PORT != null ? process.env.WEB_PORT : 80,
    phored_host: process.env.PHORED_HOST != null ? process.env.PHORED_HOST : 'http://127.0.0.1',
    phored_con_port: process.env.PHORED_PORT != null ? process.env.PHORED_PORT : 11771,
    phored_rpc_port: process.env.PHORED_RPC_PORT != null ? process.env.PHORED_RPC_PORT : 11772,
    phored_rpc_path: process.env.PHORED_RPC_PATH != null ? process.env.PHORED_RPC_PATH : "/rpc",
    rpc_user: process.env.RPC_USER,
    rpc_pass: process.env.RPC_PASS,
};
