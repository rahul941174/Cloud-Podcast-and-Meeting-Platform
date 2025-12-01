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
                background: "linear-gradient(145deg, #141414, #0d0d0d)",
                borderRadius: "14px",
                overflow: "hidden",
                border: "1px solid rgba(255,255,255,0.08)",
                boxShadow: "0 8px 22px rgba(0,0,0,0.35)",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                transition: "0.2s ease",
            }}
            onMouseOver={(e) => {
                e.currentTarget.style.boxShadow = "0 8px 30px rgba(0,0,0,0.55)";
                e.currentTarget.style.transform = "scale(1.015)";
            }}
            onMouseOut={(e) => {
                e.currentTarget.style.boxShadow = "0 8px 22px rgba(0,0,0,0.35)";
                e.currentTarget.style.transform = "scale(1)";
            }}
        >
            {/* VIDEO FEED */}
            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted={muted || isLocal}
                style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    opacity: stream ? 1 : 0.35,
                    filter: stream ? "none" : "grayscale(60%) blur(2px)",
                    transition: "opacity 0.3s ease",
                }}
            />

            {/* USERNAME BADGE */}
            <div
                style={{
                    position: "absolute",
                    bottom: "10px",
                    left: "10px",
                    padding: "6px 12px",
                    background: "rgba(0,0,0,0.55)",
                    backdropFilter: "blur(6px)",
                    color: "white",
                    borderRadius: "6px",
                    fontSize: "13px",
                    fontWeight: "500",
                    boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
                }}
            >
                {username} {isLocal && "(You)"}
            </div>

            {/* NO STREAM PLACEHOLDER */}
            {!stream && (
                <div
                    style={{
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                        color: "#aaa",
                        fontSize: "16px",
                        fontWeight: 500,
                        textShadow: "0 2px 4px rgba(0,0,0,0.6)",
                    }}
                >
                    No video stream
                </div>
            )}
        </div>
    );
};

export default VideoPlayer;
