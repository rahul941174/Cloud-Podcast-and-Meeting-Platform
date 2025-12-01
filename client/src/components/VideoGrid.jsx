import React from 'react';
import VideoPlayer from './VideoPlayer';

const VideoGrid = ({ localStream, remoteStreams, participants, currentUserId }) => {
    const totalVideos = 1 + Object.keys(remoteStreams).length;

    const getGridColumns = () => {
        if (totalVideos === 1) return 1;
        if (totalVideos === 2) return 2;
        if (totalVideos <= 4) return 2;
        return 3;
    };

    const columns = getGridColumns();

    const getUserName = (id) => {
        const p = participants.find(x => x.userId === id);
        return p ? p.username : "Unknown";
    };

    return (
        <div
            style={{
                width: "100%",
                padding: "15px 0 10px 0",
                background: "transparent",
                borderRadius: "10px",
            }}
        >
            <h3
                style={{
                    marginBottom: "15px",
                    color: "#eaeaea",
                    textAlign: "center",
                    fontWeight: "600",
                    fontSize: "20px",
                    letterSpacing: "0.5px",
                }}
            >
                🎥 Live Meeting ({totalVideos})
            </h3>

            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                    gap: "16px",
                    padding: "10px 12px",
                    minHeight: "450px",
                    background: "#0f0f0f",
                    borderRadius: "12px",
                    border: "1px solid #1c1c1c",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
                }}
            >
                {/* Local user tile */}
                <div style={{ aspectRatio: "16/9" }}>
                    <VideoPlayer
                        stream={localStream}
                        username={getUserName(currentUserId)}
                        isLocal={true}
                        muted={true}
                    />
                </div>

                {/* Remote participants */}
                {Object.entries(remoteStreams).map(([id, stream]) => (
                    <div key={id} style={{ aspectRatio: "16/9" }}>
                        <VideoPlayer
                            stream={stream}
                            username={getUserName(id)}
                            isLocal={false}
                            muted={false}
                        />
                    </div>
                ))}
            </div>

            {totalVideos === 1 && (
                <div
                    style={{
                        marginTop: "20px",
                        textAlign: "center",
                        color: "#777",
                        fontSize: "14px",
                        letterSpacing: "0.3px",
                    }}
                >
                    Waiting for others to join…
                </div>
            )}
        </div>
    );
};

export default VideoGrid;
