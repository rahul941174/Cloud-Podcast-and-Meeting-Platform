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
                padding: "20px 0",
                background: "transparent",
            }}
        >
            <h3
                style={{
                    marginBottom: "18px",
                    color: "#222",
                    textAlign: "center",
                    fontWeight: "600",
                }}
            >
                🎥 Live Meeting ({totalVideos})
            </h3>

            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                    gap: "18px",
                    padding: "10px",
                    minHeight: "420px",
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
                        letterSpacing: "0.4px",
                    }}
                >
                    Waiting for others to join…
                </div>
            )}
        </div>
    );
};

export default VideoGrid;
