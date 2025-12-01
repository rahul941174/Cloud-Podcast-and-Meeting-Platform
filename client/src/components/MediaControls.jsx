import React from 'react';

const MediaControls = ({
    isVideoEnabled,
    isAudioEnabled,
    onToggleVideo,
    onToggleAudio
}) => {
    return (
        <div
            style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: "20px",
                padding: "15px 20px",
                background: "rgba(20,20,20,0.8)",
                borderRadius: "12px",
                border: "1px solid #222",
                boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                margin: "20px auto",
                width: "fit-content",
            }}
        >
            {/* Video Toggle */}
            <button
                onClick={onToggleVideo}
                style={{
                    width: "60px",
                    height: "60px",
                    borderRadius: "50%",
                    border: "none",
                    cursor: "pointer",
                    background: isVideoEnabled ? "#1f4cff" : "#d32f2f",
                    color: "white",
                    fontSize: "22px",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    transition: "0.25s",
                    boxShadow: "0 4px 10px rgba(0,0,0,0.3)",
                }}
                onMouseOver={(e) => (e.target.style.transform = "scale(1.07)")}
                onMouseOut={(e) => (e.target.style.transform = "scale(1)")}
            >
                {isVideoEnabled ? "📹" : "📵"}
            </button>

            {/* Audio Toggle */}
            <button
                onClick={onToggleAudio}
                style={{
                    width: "60px",
                    height: "60px",
                    borderRadius: "50%",
                    border: "none",
                    cursor: "pointer",
                    background: isAudioEnabled ? "#1f4cff" : "#d32f2f",
                    color: "white",
                    fontSize: "22px",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    transition: "0.25s",
                    boxShadow: "0 4px 10px rgba(0,0,0,0.3)",
                }}
                onMouseOver={(e) => (e.target.style.transform = "scale(1.07)")}
                onMouseOut={(e) => (e.target.style.transform = "scale(1)")}
            >
                {isAudioEnabled ? "🎤" : "🔇"}
            </button>
        </div>
    );
};

export default MediaControls;
