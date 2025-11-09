import React, { useEffect, useRef } from 'react';

/**
 * VideoPlayer Component
 * 
 * Displays a single video stream (local or remote)
 * Automatically plays the stream when it's available
 */

const VideoPlayer = ({ stream, username, isLocal = false, muted = false }) => {
    const videoRef = useRef(null);

    useEffect(() => {
        if (videoRef.current && stream) {
            videoRef.current.srcObject = stream;
        }
    }, [stream]);

    return (
        <div style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            backgroundColor: '#1a1a1a',
            borderRadius: '8px',
            overflow: 'hidden',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
        }}>
            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted={muted || isLocal}  // Always mute local video to avoid echo
                style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                }}
            />
            
            {/* Username label */}
            <div style={{
                position: 'absolute',
                bottom: '10px',
                left: '10px',
                backgroundColor: 'rgba(0,0,0,0.7)',
                color: 'white',
                padding: '5px 10px',
                borderRadius: '4px',
                fontSize: '14px',
                fontWeight: '500'
            }}>
                {username} {isLocal && '(You)'}
            </div>

            {/* No stream indicator */}
            {!stream && (
                <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    color: '#888',
                    fontSize: '14px'
                }}>
                    No video stream
                </div>
            )}
        </div>
    );
};

export default VideoPlayer;