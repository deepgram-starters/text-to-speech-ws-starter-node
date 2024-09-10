const PLAY_STATES = {
    NO_AUDIO: "no_audio",
    LOADING: "loading",
    PLAYING: "playing",
};

let playState = PLAY_STATES.NO_AUDIO;
let audioPlayer;
const textArea = document.getElementById("text-input");
const errorMessage = document.querySelector("#error-message");
let audioChunks = []; // Array to buffer incoming audio data chunks
let socket;

/**
 * Normalises the header so that Firefox doesn't choke on it.
 */
function correctWavHeader(view) {
    const dataView = new DataView(view.buffer);
    
    // Correct file size (total size - 8 bytes)
    dataView.setUint32(4, view.length - 8, true);
    
    // Correct fmt chunk
    const fmtLength = dataView.getUint32(16, true);
    const sampleRate = dataView.getUint32(24, true);
    const numChannels = dataView.getUint16(22, true);
    const bitsPerSample = dataView.getUint16(34, true);
    
    console.log("WAV Header Info:");
    console.log("Format chunk length:", fmtLength);
    console.log("Sample rate:", sampleRate);
    console.log("Number of channels:", numChannels);
    console.log("Bits per sample:", bitsPerSample);
    
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    dataView.setUint32(28, byteRate, true);
    
    const blockAlign = numChannels * bitsPerSample / 8;
    dataView.setUint16(32, blockAlign, true);
    
    // Find and correct data chunk size
    let dataChunkSize = 0;
    for (let i = 36; i < view.length - 8; i++) {
        if (view[i] === 0x64 && view[i+1] === 0x61 && view[i+2] === 0x74 && view[i+3] === 0x61) {
            dataChunkSize = view.length - i - 8;
            dataView.setUint32(i + 4, dataChunkSize, true);
            break;
        }
    }
    
    console.log("Corrected data chunk size:", dataChunkSize);
    
    return new Uint8Array(dataView.buffer);
}

/**
 * Manually concatenate the chunks into a single buffer.
 */
async function concatenateChunks(chunks) {
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.size, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        const buffer = await chunk.arrayBuffer();
        result.set(new Uint8Array(buffer), offset);
        offset += buffer.byteLength;
    }
    return result.buffer;
}

// Function to update the play button based on the current state
function updatePlayButton() {
    const playButton = document.getElementById("play-button");
    const icon = playButton.querySelector(".button-icon");

    switch (playState) {
        case PLAY_STATES.NO_AUDIO:
            icon.className = "button-icon fa-solid fa-play";
            break;
        case PLAY_STATES.LOADING:
            icon.className = "button-icon fa-solid fa-circle-notch";
            break;
        case PLAY_STATES.PLAYING:
            icon.className = "button-icon fa-solid fa-stop";
            break;
        default:
            break;
    }
}

// Function to stop audio
function stopAudio() {
    audioPlayer = document.getElementById("audio-player");
    if (audioPlayer) {
        playState = PLAY_STATES.PLAYING;
        updatePlayButton();
        audioPlayer.pause();
        audioPlayer.currentTime = 0;
        audioPlayer = null;
    }
}

// Function to handle the click event on the play button
function playButtonClick() {
    switch (playState) {
        case PLAY_STATES.NO_AUDIO:
            sendData();
            break;
        case PLAY_STATES.PLAYING:
            stopAudio();
            playState = PLAY_STATES.NO_AUDIO;
            updatePlayButton();
            break;
        default:
            break;
    }
}

// Remove error message when the text area has a value
textArea.addEventListener("input", () => {
    errorMessage.innerHTML = "";
});

// Function to send data to backend via WebSocket
function sendData() {
    const modelSelect = document.getElementById("models");
    const selectedModel = modelSelect.options[modelSelect.selectedIndex].value;
    const textInput = document.getElementById("text-input").value;
    if (!textInput) {
        errorMessage.innerHTML = "ERROR: Please add text!";
    } else {
        playState = PLAY_STATES.LOADING;
        updatePlayButton();

        // we want to simulate holding a connection open like you would for a websocket
        // that's the reason why we only initialize once
        if (!socket) {
            // create a new WebSocket connection
            socket = new WebSocket(`ws://localhost:3000`);

            // disable the model select
            modelSelect.disabled = true;

            socket.addEventListener("open", () => {
                const data = {
                    text: textInput,
                };
                socket.send(JSON.stringify(data));
            });

            socket.addEventListener("message", async (event) => {
                // console.log("Incoming event:", event);

                if (typeof event.data === "string") {
                    console.log("Incoming text data:", event.data);

                    let msg = JSON.parse(event.data);

                    if (msg.type === "Open") {
                        console.log("WebSocket opened 2");
                    } else if (msg.type === "Error") {
                        console.error("WebSocket error:", error);
                        playState = PLAY_STATES.NO_AUDIO;
                        updatePlayButton();
                    } else if (msg.type === "Close") {
                        console.log("WebSocket closed");
                        playState = PLAY_STATES.NO_AUDIO;
                        updatePlayButton();
                    } else if (msg.type === "Flushed") {
                        console.log("Flushed received");
                        const concatenatedBuffer = await concatenateChunks(audioChunks);
                        const correctedHeader = correctWavHeader(new Uint8Array(concatenatedBuffer));
                        // All data received, now combine chunks and play audio
                        const blob = new Blob([correctedHeader], { type: "audio/wav" });

                        if (window.MediaSource) {
                            console.log('MP4 audio is supported');
                            const audioContext = new AudioContext();
                    
                            const reader = new FileReader();
                            reader.onload = function () {
                                const arrayBuffer = this.result;
                    
                                audioContext.decodeAudioData(arrayBuffer, (buffer) => {
                                    const source = audioContext.createBufferSource();
                                    source.buffer = buffer;
                                    source.connect(audioContext.destination);
                                    source.start();
                    
                                    playState = PLAY_STATES.PLAYING;
                                    updatePlayButton();
                    
                                    source.onended = () => {
                                        // Clear the buffer
                                        audioChunks = [];
                                        playState = PLAY_STATES.NO_AUDIO;
                                        updatePlayButton();
                                    };
                                });
                            };
                            reader.readAsArrayBuffer(blob);
                        } else {
                            console.error('MP4 audio is NOT supported');
                        }
            
                        // Clear the buffer
                        audioChunks = [];
                    }
                }

                if (event.data instanceof Blob) {
                    // Incoming audio blob data
                    const blob = event.data;
                    console.log("Incoming blob data:", blob);

                    // Push each blob into the array
                    audioChunks.push(blob);
                }
            });
            
            socket.addEventListener("close", () => {
                console.log("Close received");
                playState = PLAY_STATES.NO_AUDIO;
                updatePlayButton();
            });

            socket.addEventListener("error", (error) => {
                console.error("WebSocket error:", error);
                playState = PLAY_STATES.NO_AUDIO;
                updatePlayButton();
            });
        } else {
            const data = {
                text: textInput,
            };
            socket.send(JSON.stringify(data));
        }
    }
}

// Event listener for the click event on the play button
document
    .getElementById("play-button")
    .addEventListener("click", playButtonClick);
