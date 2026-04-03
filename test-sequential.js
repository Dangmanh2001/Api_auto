const axios = require('axios');

async function testSequentialTasks() {
  const baseURL = 'http://localhost:3000';

  console.log('🚀 Bắt đầu test sequential tasks...');

  // Gửi 3 task Text to Video cùng lúc
  const tasks = [
    { prompts: 'Một chú chó đang chạy trên đồng cỏ xanh', aspectRatio: '16:9', modelType: 'veo-2' },
    { prompts: 'Một con mèo đang ngủ trên ghế sofa', aspectRatio: '16:9', modelType: 'veo-2' },
    { prompts: 'Một chú chim bay trên bầu trời xanh', aspectRatio: '16:9', modelType: 'veo-2' }
  ];

  const promises = tasks.map((task, index) => {
    return axios.post(`${baseURL}/api`, new URLSearchParams({
      prompts: task.prompts,
      aspectRatio: task.aspectRatio,
      modelType: task.modelType,
      agentId: 'test-agent'
    }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }).then(() => {
      console.log(`✅ Đã gửi task ${index + 1}`);
    }).catch(err => {
      console.log(`❌ Lỗi gửi task ${index + 1}:`, err.message);
    });
  });

  await Promise.all(promises);

  console.log('📋 Tất cả task đã được gửi. Quan sát logs server để xem sequential execution...');

  // Theo dõi tasks qua API
  setInterval(async () => {
    try {
      const res = await axios.get(`${baseURL}/api/tasks`);
      const tasks = res.data;
      console.log('📊 Trạng thái tasks:');
      tasks.forEach(task => {
        console.log(`  Task #${task.id} [${task.type}]: ${task.status} (${task.logs.length} logs)`);
      });
    } catch (err) {
      console.log('❌ Lỗi lấy tasks:', err.message);
    }
  }, 5000); // Cập nhật mỗi 5 giây
}

testSequentialTasks();