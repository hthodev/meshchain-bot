const fs = require('fs');
const path = require('path');
const axios = require('axios');
const colors = require('colors');
const readline = require('readline');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { DateTime } = require('luxon');

class MeshAPIClient {
    constructor() {
        this.headers = {
            "Accept": "application/json, text/plain, */*",
            "Accept-Encoding": "gzip, deflate, br",
            "Accept-Language": "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5",
            "Content-Type": "application/json",
            "Origin": "https://miniapp.meshchain.ai",
            "Referer": "https://miniapp.meshchain.ai/",
            "Sec-Ch-Ua": '"Not/A)Brand";v="99", "Google Chrome";v="115", "Chromium";v="115"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors", 
            "Sec-Fetch-Site": "same-site",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
        };
        this.loadProxies();
    }

    loadProxies() {
        try {
            const proxyFile = path.join(__dirname, 'proxy.txt');
            this.proxies = fs.readFileSync(proxyFile, 'utf8')
                .replace(/\r/g, '')
                .split('\n')
                .filter(Boolean);
        } catch (error) {
            this.log('Error loading proxies: ' + error.message, 'error');
            this.proxies = [];
        }
    }

    getProxyConfig(index) {
        if (this.proxies[index]) {
            return {
                httpsAgent: new HttpsProxyAgent(this.proxies[index])
            };
        }
        return {};
    }

    async checkProxyIP(proxy) {
        try {
            const proxyAgent = new HttpsProxyAgent(proxy);
            const response = await axios.get('https://api.ipify.org?format=json', {
                httpsAgent: proxyAgent
            });
            if (response.status === 200) {
                return response.data.ip;
            } else {
                throw new Error(`Không thể kiểm tra IP của proxy. Status code: ${response.status}`);
            }
        } catch (error) {
            throw new Error(`Error khi kiểm tra IP của proxy: ${error.message}`);
        }
    }

    log(msg, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        switch(type) {
            case 'success':
                console.log(`[${timestamp}] [✓] ${msg}`.green);
                break;
            case 'custom':
                console.log(`[${timestamp}] [*] ${msg}`.magenta);
                break;        
            case 'error':
                console.log(`[${timestamp}] [✗] ${msg}`.red);
                break;
            case 'warning':
                console.log(`[${timestamp}] [!] ${msg}`.yellow);
                break;
            default:
                console.log(`[${timestamp}] [ℹ] ${msg}`.blue);
        }
    }

    async countdown(seconds) {
        for (let i = seconds; i > 0; i--) {
            const timestamp = new Date().toLocaleTimeString();
            readline.cursorTo(process.stdout, 0);
            process.stdout.write(`[${timestamp}] [*] Chờ ${i} giây để tiếp tục...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        readline.cursorTo(process.stdout, 0);
        readline.clearLine(process.stdout, 0);
    }

    async retry(fn, retries = 3, delay = 5000) {
        for (let i = 0; i < retries; i++) {
            try {
                return await fn();
            } catch (error) {
                if (i === retries - 1) throw error;
                this.log(`Lỗi: ${error.message}. Thử lại sau ${delay/1000}s... (${i + 1}/${retries})`, 'warning');
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    async login(authData, proxyConfig) {
        return this.retry(async () => {
            try {
                const response = await axios.post('https://api.meshchain.ai/meshmain/auth/telegram-miniapp-signin', 
                    { referral_code: "T_7508641166" },
                    { 
                        headers: {
                            ...this.headers,
                            'Authorization': `tma ${authData}`
                        },
                        ...proxyConfig
                    }
                );
                return response.data;
            } catch (error) {
                const errorMsg = error.response?.data?.message || error.message;
                throw new Error(`Login failed: ${errorMsg}`);
            }
        });
    }

    async checkNodeStatus(token, uniqueId, proxyConfig) {
        return this.retry(async () => {
            try {
                const response = await axios.post('https://api.meshchain.ai/meshmain/nodes/status',
                    { unique_id: String(uniqueId) },
                    {
                        headers: {
                            ...this.headers,
                            'Authorization': `Bearer ${token}`
                        },
                        ...proxyConfig
                    }
                );
    
                if (response.data && response.data.is_linked !== undefined) {
                    if (response.data.is_linked) {
                        return {
                            isLinked: true,
                            total_reward: response.data.total_reward,
                            today_reward: response.data.today_reward,
                            hash_rate: response.data.hash_rate,
                            nodeId: response.data.id
                        };
                    } else {
                        return { needsLink: true };
                    }
                }
    
                throw new Error('Invalid response format from server');
    
            } catch (error) {
                console.log(error);
                if (error.response) {
                    if (error.response.status === 409) {
                        return { needsLink: true };
                    }
                    if (error.response.status === 500) {
                        this.log('Server error, waiting 30 seconds before retry...', 'warning');
                        await new Promise(resolve => setTimeout(resolve, 30000));
                        throw new Error('Server error, retrying...');
                    }
                    throw new Error(`Status check failed: ${error.response.data?.message || error.response.status}`);
                }
    
                throw new Error(`Status check failed: ${error.message}`);
            }
        }, 5, 30000);
    }

    async linkNode(token, uniqueId, name, tgData, proxyConfig) {
        return this.retry(async () => {
            try {
                const response = await axios.post('https://api.meshchain.ai/meshmain/nodes/link',
                    {
                        unique_id: uniqueId,
                        node_type: "telegram",
                        name: name,
                        tg_data: tgData
                    },
                    {
                        headers: {
                            ...this.headers,
                            'Authorization': `Bearer ${token}`
                        },
                        ...proxyConfig
                    }
                );
                return response.data;
            } catch (error) {
                if (error.response?.status === 500) {
                    this.log('Server error, waiting 30 seconds before retry...', 'warning');
                    await new Promise(resolve => setTimeout(resolve, 30000));
                    throw new Error('Server error, retrying...');
                }
                throw new Error(`Node linking failed: ${error.response?.data?.message || error.message}`);
            }
        }, 5, 30000);
    }

    async checkMissions(token, proxyConfig) {
        return this.retry(async () => {
            try {
                const response = await axios.get('https://api.meshchain.ai/meshmain/mission', {
                    headers: {
                        ...this.headers,
                        'Authorization': `Bearer ${token}`
                    },
                    ...proxyConfig
                });
                return response.data;
            } catch (error) {
                throw new Error(`Failed to fetch missions: ${error.response?.data?.message || error.message}`);
            }
        });
    }

    async estimateRewards(token, uniqueId, proxyConfig) {
        return this.retry(async () => {
            try {
                const response = await axios.post('https://api.meshchain.ai/meshmain/rewards/estimate',
                    { unique_id: String(uniqueId) },
                    {
                        headers: {
                            ...this.headers,
                            'Authorization': `Bearer ${token}`
                        },
                        ...proxyConfig
                    }
                );
                return response.data;
            } catch (error) {
                if (error.response?.status === 400 && 
                    error.response?.data?.message === "The mining process is not started") {
                    return { needsStart: true };
                }
                throw new Error(`Failed to estimate rewards: ${error.response?.data?.message || error.message}`);
            }
        });
    }

    async startMining(token, uniqueId, proxyConfig) {
        return this.retry(async () => {
            try {
                const response = await axios.post('https://api.meshchain.ai/meshmain/rewards/start',
                    { unique_id: String(uniqueId) },
                    {
                        headers: {
                            ...this.headers,
                            'Authorization': `Bearer ${token}`
                        },
                        ...proxyConfig
                    }
                );
                return response.data;
            } catch (error) {
                throw new Error(`Failed to start mining: ${error.response?.data?.message || error.message}`);
            }
        });
    }

    async claimRewards(token, uniqueId, proxyConfig) {
        return this.retry(async () => {
            try {
                const response = await axios.post('https://api.meshchain.ai/meshmain/rewards/claim',
                    { unique_id: String(uniqueId) },
                    {
                        headers: {
                            ...this.headers,
                            'Authorization': `Bearer ${token}`
                        },
                        ...proxyConfig
                    }
                );
                return response.data;
            } catch (error) {
                throw new Error(`Failed to claim rewards: ${error.response?.data?.message || error.message}`);
            }
        });
    }

    async claimMission(token, missionId, proxyConfig) {
        return this.retry(async () => {
            try {
                const response = await axios.post('https://api.meshchain.ai/meshmain/mission/claim',
                    { mission_id: missionId },
                    {
                        headers: {
                            ...this.headers,
                            'Authorization': `Bearer ${token}`
                        },
                        ...proxyConfig
                    }
                );
                return response.data;
            } catch (error) {
                throw new Error(`Failed to claim mission ${missionId}: ${error.response?.data?.message || error.message}`);
            }
        });
    }

    formatClaimTime(isoTime) {
        return DateTime.fromISO(isoTime)
            .setZone('Asia/Ho_Chi_Minh')
            .toFormat('HH:mm:ss dd/MM/yyyy');
    }

    async processAccount(authData, index) {
        const userData = JSON.parse(decodeURIComponent(authData.split('user=')[1].split('&')[0]));
        const uniqueId = userData.id;
        const username = userData.username;
        const firstName = userData.first_name;
        const proxyConfig = this.getProxyConfig(index);
        
        let proxyIP = "No proxy";
        if (this.proxies[index]) {
            try {
                proxyIP = await this.checkProxyIP(this.proxies[index]);
            } catch (error) {
                this.log(`Error checking proxy IP: ${error.message}`, 'warning');
            }
        }
    
        console.log(`========== Tài khoản ${index + 1} | ${firstName.green} | ip: ${proxyIP} ==========`);
    
        try {
            this.log(`Đang đăng nhập tài khoản ${uniqueId}...`, 'info');
            const loginResult = await this.login(authData, proxyConfig);
            this.log('Đăng nhập thành công!', 'success');

            const statusResult = await this.checkNodeStatus(loginResult.access_token, uniqueId, proxyConfig);
            if (statusResult.needsLink) {
                this.log('Node chưa được liên kết, đang liên kết...', 'info');
                const linkResult = await this.linkNode(
                    loginResult.access_token,
                    uniqueId,
                    username,
                    authData,
                    proxyConfig
                );
                this.log(`Liên kết thành công! Total Reward: ${linkResult.total_reward}`, 'success');
            } else if (statusResult.isLinked) {
                this.log(`Node đã được liên kết:`, 'success');
                this.log(`Node ID: ${statusResult.nodeId}`, 'custom');
                this.log(`Total Reward: ${statusResult.total_reward}`, 'custom');
                this.log(`Today's Reward: ${statusResult.today_reward}`, 'custom');
                this.log(`Hash Rate: ${statusResult.hash_rate}`, 'custom');
            }

            this.log('Đang kiểm tra nhiệm vụ...', 'info');
            const missions = await this.checkMissions(loginResult.access_token, proxyConfig);
            
            const missionIds = [
                'ACCOUNT_VERIFICATION',
                'JOIN_OUR_TELEGRAM_CHANNEL',
                'JOIN_OUR_DISCORD_CHANNEL',
                'FOLLOW_BOUNCETON_ON_X'
            ];

            for (const missionId of missionIds) {
                const mission = missions.find(m => m.id === missionId);
                if (mission && !mission.claimed_at) {
                    this.log(`Phát hiện nhiệm vụ ${missionId} chưa claim, đang claim...`, 'info');
                    try {
                        const claimResult = await this.claimMission(loginResult.access_token, missionId, proxyConfig);
                        if (claimResult.claimed_at) {
                            this.log(`Claim ${missionId} thành công!`, 'success');
                        }
                    } catch (error) {
                        this.log(`Không thể claim ${missionId}: ${error.message}`, 'warning');
                    }
                } else if (mission?.claimed_at) {
                    this.log(`Nhiệm vụ ${missionId} đã được claim trước đó`, 'custom');
                }
            }
            this.log('Đang kiểm tra trạng thái mining...', 'info');
            const estimateResult = await this.estimateRewards(loginResult.access_token, uniqueId, proxyConfig);
            
            if (estimateResult.needsStart) {
                this.log('Mining chưa được bắt đầu, đang khởi động...', 'info');
                const startResult = await this.startMining(loginResult.access_token, uniqueId, proxyConfig);
                const claimTime = this.formatClaimTime(startResult.cycle_ended_at);
                this.log(`Mining đã bắt đầu! Thời gian claim tiếp theo: ${claimTime}`, 'success');
            } else if (estimateResult.claimable) {
                if (estimateResult.filled) {
                    this.log(`Phát hiện ${estimateResult.value} Point có thể claim!`, 'success');
                    const claimResult = await this.claimRewards(loginResult.access_token, uniqueId, proxyConfig);
                    const nextClaimTime = this.formatClaimTime(claimResult.cycle_ended_at);
                    this.log(`Claim thành công! Thời gian claim tiếp theo: ${nextClaimTime}`, 'success');
                } else {
                    this.log(`Chưa đến thời gian claim point (${estimateResult.value} Point - ${Math.round(estimateResult.time_elapsed_sec / 60)} phút)`, 'warning');
                }
            }
        } catch (error) {
            this.log(`Xử lý tài khoản thất bại: ${error.message}`, 'error');
        }
    }

    async main() {
        const dataFile = path.join(__dirname, 'data.txt');
        const data = fs.readFileSync(dataFile, 'utf8')
            .replace(/\r/g, '')
            .split('\n')
            .filter(Boolean);

        while (true) {
            for (let i = 0; i < data.length; i++) {
                try {
                    await this.processAccount(data[i], i);
                } catch (error) {
                    this.log(`Bỏ qua tài khoản này và chuyển sang tài khoản tiếp theo...`, 'warning');
                }
                await new Promise(resolve => setTimeout(resolve, 5000));
            }

            await this.countdown(120 * 60);
        }
    }
}

const client = new MeshAPIClient();
client.main().catch(err => {
    client.log(err.message, 'error');
    process.exit(1);
});