import React, { useEffect, useRef } from 'react';

const VideoPlayer = ({ stream, username, isLocal = false, muted = false }) => {
    const videoRef = useRef(null);

    useEffect(() => {
        if (videoRef.current && stream) {
            videoRef.current.srcObject = stream;
        }
    }, [stream]);

    return (
        <div
            style={{
                position: "relative",
                width: "100%",
                height: "100%",
                background: "linear-gradient(135deg, #1e1e1e, #2a2a2a)",
                borderRadius: "14px",
                overflow: "hidden",
                border: "1px solid rgba(255,255,255,0.08)",
                boxShadow: "0 8px 25px rgba(0,0,0,0.3)",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
            }}
        >
            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted={muted || isLocal}
                style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    filter: stream ? "none" : "grayscale(70%) blur(3px)",
                    transition: "0.3s ease-in-out",
                }}
            />

            {/* Username badge */}
            <div
                style={{
                    position: "absolute",
                    bottom: "12px",
                    left: "12px",
                    padding: "6px 14px",
                    background: "rgba(0,0,0,0.55)",
                    backdropFilter: "blur(6px)",
                    color: "#fff",
                    borderRadius: "6px",
                    fontSize: "13px",
                    fontWeight: "500",
                    boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
                }}
            >
                {username} {isLocal && "(You)"}
            </div>

            {/* No stream placeholder */}
            {!stream && (
                <div
                    style={{
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                        color: "#bbb",
                        fontSize: "16px",
                        fontWeight: 500,
                        textShadow: "0 2px 4px rgba(0,0,0,0.5)",
                    }}
                >
                    No video stream
                </div>
            )}
        </div>
    );
};

export default VideoPlayer;
