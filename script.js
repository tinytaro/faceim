// 全局变量
let currentCell = -1;
let currentPinyin = '';
let inputText = '';
let lastMouthActionTime = 0;
let mouthActionCooldown = 500; // 嘴部动作冷却时间（毫秒）
let isMouthOpen = false; // 跟踪当前嘴巴状态
let mouthOpenThreshold = 0.035; // 嘴巴张开的阈值
let mouthCloseThreshold = 0.025; // 嘴巴闭合的阈值
let faceMesh;
let camera;
let candidates = [];
let candidateIndex = 0;

// 在脚本顶部添加设备检测代码
let isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
let deviceInfoElement = document.getElementById('device-info');
let errorMessageElement = document.getElementById('error-message');

// 全局变量中添加对新元素的引用
const permissionContainer = document.getElementById('permission-container');
const permissionButton = document.getElementById('permission-button');

// 简化版的拼音到汉字的映射（实际使用时应该有更完整的词库）
const pinyinMap = {
    'a': ['啊', '阿', '吖'],
    'ai': ['爱', '埃', '哎'],
    'an': ['安', '按', '暗'],
    'ba': ['八', '爸', '吧'],
    'de': ['的', '得', '地'],
    'wo': ['我', '窝', '握'],
    'ni': ['你', '尼', '呢'],
    'hao': ['好', '号', '毫'],
    'shi': ['是', '时', '事'],
    'ma': ['吗', '妈', '马'],
    // 这里可以添加更多的拼音映射
};

// 九宫格按键映射
const keyboardMap = [
    ['1', '一', '丨'],
    ['2', 'a', 'b', 'c'],
    ['3', 'd', 'e', 'f'],
    ['4', 'g', 'h', 'i'],
    ['5', 'j', 'k', 'l'],
    ['6', 'm', 'n', 'o'],
    ['7', 'p', 'q', 'r', 's'],
    ['8', 't', 'u', 'v'],
    ['9', 'w', 'x', 'y', 'z']
];

// DOM 元素引用
const inputTextElem = document.getElementById('input-text');
const currentPinyinElem = document.getElementById('current-pinyin');
const candidatesContainer = document.getElementById('candidates-container');
const gridCells = document.querySelectorAll('.grid-cell');
const videoElement = document.getElementById('input-video');
const canvasElement = document.getElementById('output-canvas');
const canvasCtx = canvasElement.getContext('2d');

// 初始化 MediaPipe FaceMesh
function initFaceMesh() {
    try {
        faceMesh = new FaceMesh({
            locateFile: (file) => {
                return `js/mediapipe/face_mesh/${file}`;
            }
        });

        // 设置模型加载回调
        faceMesh.onResults(onResults);

        faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        // 在模型加载完成后启动摄像头
        faceMesh.initialize().then(() => {
            console.log('FaceMesh模型加载完成');
            
            camera = new Camera(videoElement, {
                onFrame: async () => {
                    try {
                        await faceMesh.send({image: videoElement});
                    } catch (e) {
                        console.error('FaceMesh处理错误:', e);
                    }
                },
                width: 640,
                height: 480
            });

            camera.start()
                .then(() => {
                    console.log('摄像头启动成功');
                })
                .catch(error => {
                    console.error('摄像头启动失败:', error);
                    showError('无法访问摄像头，请确保已授予摄像头访问权限');
                });
        }).catch(error => {
            console.error('FaceMesh模型加载失败:', error);
            showError('人脸检测模型加载失败，请检查网络连接并刷新页面');
        });
    } catch (e) {
        console.error('FaceMesh初始化错误:', e);
        showError('人脸检测初始化失败');
    }
}

// 处理 FaceMesh 结果，修复文本显示
function onResults(results) {
    // 绘制摄像头图像（镜像）
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
        const landmarks = results.multiFaceLandmarks[0];
        
        // 鼻尖的索引为4
        const noseTip = landmarks[4];
        
        // 获取人脸参考点 - 修改为更低的位置
        // 使用眼睛中心点和嘴巴上唇点的组合
        const leftEye = landmarks[33];  // 左眼中心
        const rightEye = landmarks[263]; // 右眼中心
        const upperLip = landmarks[13]; // 上唇中心
        
        // 计算新的参考点，降低参考点位置
        const eyesCenter = {
            x: (leftEye.x + rightEye.x) / 2,
            y: (leftEye.y + rightEye.y) / 2
        };
        
        // 使用眼睛中心与上唇的加权平均，权重调整为60%眼睛，40%嘴巴
        const faceCenterX = eyesCenter.x * 0.5 + upperLip.x * 0.5;
        const faceCenterY = eyesCenter.y * 0.5 + upperLip.y * 0.5;
        
        // 计算鼻尖相对于人脸中心的方向向量
        const dirX = noseTip.x - faceCenterX;
        const dirY = noseTip.y - faceCenterY;
        
        // 计算方向角度
        let angle = Math.atan2(dirY, dirX) * 180 / Math.PI;
        
        // 计算偏移距离（归一化）
        const distance = Math.sqrt(dirX * dirX + dirY * dirY);
        
        // 只有当距离超过阈值时才考虑方向
        const distanceThreshold = 0.03;
        let cellIndex = 4; // 默认中间格子
        
        if (distance > distanceThreshold) {
            // 根据角度确定选中的格子，修正镜像问题（左右方向调换）
            if (angle < -157.5 || angle >= 157.5) {
                cellIndex = 5; // 右（原来是左）
            } else if (angle >= -157.5 && angle < -112.5) {
                cellIndex = 2; // 右上（原来是左上）
            } else if (angle >= -112.5 && angle < -67.5) {
                cellIndex = 1; // 上
            } else if (angle >= -67.5 && angle < -22.5) {
                cellIndex = 0; // 左上（原来是右上）
            } else if (angle >= -22.5 && angle < 22.5) {
                cellIndex = 3; // 左（原来是右）
            } else if (angle >= 22.5 && angle < 67.5) {
                cellIndex = 6; // 左下（原来是右下）
            } else if (angle >= 67.5 && angle < 112.5) {
                cellIndex = 7; // 下
            } else if (angle >= 112.5 && angle < 157.5) {
                cellIndex = 8; // 右下（原来是左下）
            }
        }
        
        // 获取嘴部标记点
        const lowerLip = landmarks[14];  // 下唇中心
        
        // 计算嘴部开合度
        const mouthOpenness = Math.abs(upperLip.y - lowerLip.y);
        
        // 检测嘴部动作
        const currentTime = Date.now();
        
        // 在绘制文本前，对canvas上下文应用额外的水平翻转以抵消CSS的镜像效果
        // 在显示嘴部状态之前先保存当前状态
        canvasCtx.save();
        // 翻转文本，这样在镜像画面上会显示正常方向
        canvasCtx.scale(-1, 1);
        canvasCtx.font = isMobileDevice ? '14px Arial' : '20px Arial';
        canvasCtx.fillStyle = 'white';
        // 注意：由于已经翻转，所以x坐标要取负值
        const textX = -canvasElement.width + 150;
        canvasCtx.fillText(`开合度: ${mouthOpenness.toFixed(3)}`, textX, 30);
        canvasCtx.fillText(`状态: ${isMouthOpen ? '张开' : '闭合'}`, textX, 60);
        // 恢复canvas上下文的状态
        canvasCtx.restore();
        
        // 检测张嘴->闭嘴的动作序列
        if (!isMouthOpen && mouthOpenness > mouthOpenThreshold) {
            // 嘴巴从闭合变为张开
            isMouthOpen = true;
            lastMouthActionTime = currentTime;
        } else if (isMouthOpen && mouthOpenness < mouthCloseThreshold && 
                   (currentTime - lastMouthActionTime > mouthActionCooldown)) {
            // 嘴巴从张开变为闭合，并且间隔足够长（避免误触发）
            isMouthOpen = false;
            handleCellConfirmation(currentCell);
        }
        
        // 更新高亮的格子
        updateActiveCell(cellIndex);
        
        // 绘制鼻尖位置点
        canvasCtx.fillStyle = 'red';
        canvasCtx.beginPath();
        canvasCtx.arc(
            noseTip.x * canvasElement.width,
            noseTip.y * canvasElement.height,
            5, 0, 2 * Math.PI);
        canvasCtx.fill();
        
        // 绘制参考点
        canvasCtx.fillStyle = 'blue';
        canvasCtx.beginPath();
        canvasCtx.arc(
            faceCenterX * canvasElement.width,
            faceCenterY * canvasElement.height,
            5, 0, 2 * Math.PI);
        canvasCtx.fill();
        
        // 同时绘制原眼睛中心点（用于比较）
        canvasCtx.fillStyle = 'rgba(0, 255, 255, 0.5)';
        canvasCtx.beginPath();
        canvasCtx.arc(
            eyesCenter.x * canvasElement.width,
            eyesCenter.y * canvasElement.height,
            4, 0, 2 * Math.PI);
        canvasCtx.fill();
        
        // 绘制方向线
        canvasCtx.strokeStyle = 'yellow';
        canvasCtx.lineWidth = 2;
        canvasCtx.beginPath();
        canvasCtx.moveTo(faceCenterX * canvasElement.width, faceCenterY * canvasElement.height);
        canvasCtx.lineTo(noseTip.x * canvasElement.width, noseTip.y * canvasElement.height);
        canvasCtx.stroke();
        
        // 绘制嘴部关键点
        canvasCtx.fillStyle = 'green';
        canvasCtx.beginPath();
        canvasCtx.arc(
            upperLip.x * canvasElement.width,
            upperLip.y * canvasElement.height,
            4, 0, 2 * Math.PI);
        canvasCtx.fill();
        
        canvasCtx.fillStyle = 'green';
        canvasCtx.beginPath();
        canvasCtx.arc(
            lowerLip.x * canvasElement.width,
            lowerLip.y * canvasElement.height,
            4, 0, 2 * Math.PI);
        canvasCtx.fill();
    }

    canvasCtx.restore();
}

// 更新当前活跃的格子
function updateActiveCell(cellIndex) {
    if (cellIndex !== currentCell && cellIndex >= 0 && cellIndex < 9) {
        gridCells.forEach(cell => cell.classList.remove('active'));
        gridCells[cellIndex].classList.add('active');
        currentCell = cellIndex;
    }
}

// 处理格子确认动作
function handleCellConfirmation(cellIndex) {
    if (cellIndex < 0 || cellIndex >= 9) return;
    
    // 如果有候选汉字，先处理候选汉字的选择
    if (candidates.length > 0) {
        inputText += candidates[candidateIndex];
        inputTextElem.textContent = inputText;
        clearCandidates();
        currentPinyin = '';
        currentPinyinElem.textContent = '';
        return;
    }
    
    const keys = keyboardMap[cellIndex];
    
    // 如果当前拼音为空，则开始一个新拼音
    if (currentPinyin === '') {
        // 对于非字母按键，直接输入
        if (cellIndex === 0) { // 数字或特殊符号键
            inputText += keys[0]; // 添加数字1
            inputTextElem.textContent = inputText;
            return;
        }
        
        currentPinyin = keys[1]; // 取第一个字母
    } else {
        // 继续添加字母到拼音
        if (cellIndex === 0) { // 如果按了数字键，完成当前拼音输入
            lookupCandidates(currentPinyin);
            return;
        }
        
        currentPinyin += keys[1]; // 添加第一个字母
    }
    
    currentPinyinElem.textContent = currentPinyin;
    
    // 查询是否有匹配的汉字
    lookupCandidates(currentPinyin);
}

// 查找候选汉字
function lookupCandidates(pinyin) {
    candidates = pinyinMap[pinyin] || [];
    
    if (candidates.length > 0) {
        candidateIndex = 0;
        displayCandidates();
    }
}

// 显示候选汉字
function displayCandidates() {
    candidatesContainer.innerHTML = '';
    
    candidates.forEach((candidate, index) => {
        const candidateElem = document.createElement('div');
        candidateElem.classList.add('candidate');
        candidateElem.textContent = candidate;
        
        if (index === candidateIndex) {
            candidateElem.classList.add('active');
        }
        
        candidatesContainer.appendChild(candidateElem);
    });
}

// 清除候选汉字
function clearCandidates() {
    candidates = [];
    candidateIndex = 0;
    candidatesContainer.innerHTML = '';
}

// 初始化应用
window.onload = function() {
    // 显示设备信息
    deviceInfoElement.textContent = `设备类型: ${isMobileDevice ? '移动设备' : '电脑'}`;
    
    // 检查浏览器对MediaDevices API的支持
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showError('您的浏览器不支持摄像头访问');
        return;
    }
    
    // 调整 canvas 尺寸以匹配视频元素
    updateCanvasSize();
    
    // 设置权限按钮点击事件
    permissionButton.addEventListener('click', requestCameraPermission);
    
    // 显示权限提示
    showPermissionPrompt();
};

// 请求摄像头权限函数
function requestCameraPermission() {
    // 隐藏权限提示
    hidePermissionPrompt();
    
    // 尝试访问摄像头
    navigator.mediaDevices.getUserMedia({ video: true })
        .then(() => {
            console.log('摄像头权限已授予');
            // 初始化人脸检测
            initFaceMesh();
        })
        .catch(error => {
            console.error('摄像头访问失败:', error);
            showError('无法访问摄像头，请确保已授予摄像头访问权限，并刷新页面重试');
        });
}

// 权限提示显示和隐藏函数
function showPermissionPrompt() {
    permissionContainer.style.display = 'flex';
}

function hidePermissionPrompt() {
    permissionContainer.style.display = 'none';
}

// 添加错误消息显示函数
function showError(message) {
    errorMessageElement.textContent = message;
    errorMessageElement.style.display = 'block';
}

// 窗口大小改变时更新 canvas 尺寸
function updateCanvasSize() {
    canvasElement.width = videoElement.clientWidth;
    canvasElement.height = videoElement.clientHeight;
}

window.onresize = updateCanvasSize;

// 添加触摸事件支持
document.addEventListener('DOMContentLoaded', function() {
    // 防止iOS上的双击缩放
    document.addEventListener('touchend', function(event) {
        if (event.touches.length === 0) {
            event.preventDefault();
        }
    });
    
    // 防止移动设备上的页面拖动
    document.body.addEventListener('touchmove', function(e) {
        e.preventDefault();
    }, { passive: false });
});

// 确保在页面可见性变化时正确处理摄像头
document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        // 页面不可见时，可以考虑暂停摄像头
        if (camera) {
            camera.stop();
        }
    } else {
        // 页面重新可见时，重启摄像头
        if (camera) {
            camera.start().catch(e => {
                console.error('摄像头重启失败:', e);
                showError('摄像头重启失败，请刷新页面');
            });
        }
    }
}); 