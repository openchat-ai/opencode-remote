// Approval workflow for OpenCode Remote Control
import { loadConfig } from './types.js';
const approvalCallbacks = new Map();
export function createApprovalRequest(session, type, data) {
    const config = loadConfig();
    const now = Date.now();
    const request = {
        id: crypto.randomUUID(),
        type,
        description: data.description,
        files: data.files,
        command: data.command,
        createdAt: now,
        expiresAt: now + config.approvalTimeoutMs,
    };
    // Add to session's pending approvals
    session.pendingApprovals.push(request);
    return request;
}
export function getPendingApproval(session, requestId) {
    if (requestId) {
        return session.pendingApprovals.find(r => r.id === requestId);
    }
    return session.pendingApprovals[0]; // Return first pending
}
export function resolveApproval(session, requestId, approved) {
    const index = session.pendingApprovals.findIndex(r => r.id === requestId);
    if (index === -1) {
        return { success: false, error: 'Approval request not found' };
    }
    const request = session.pendingApprovals[index];
    // Check if expired
    if (Date.now() > request.expiresAt) {
        session.pendingApprovals.splice(index, 1);
        return { success: false, error: 'Approval request expired', request };
    }
    // Remove from pending
    session.pendingApprovals.splice(index, 1);
    // Resolve the promise if there's a callback
    const callback = approvalCallbacks.get(requestId);
    if (callback) {
        callback.resolve(approved);
        approvalCallbacks.delete(requestId);
    }
    return { success: true, request };
}
export function waitForApproval(request) {
    return new Promise((resolve, reject) => {
        approvalCallbacks.set(request.id, { resolve, reject });
        // Auto-reject on timeout
        const timeUntilExpiry = request.expiresAt - Date.now();
        setTimeout(() => {
            const callback = approvalCallbacks.get(request.id);
            if (callback) {
                approvalCallbacks.delete(request.id);
                callback.resolve(false); // Auto-reject
            }
        }, timeUntilExpiry);
    });
}
export function cancelAllApprovals(session) {
    for (const request of session.pendingApprovals) {
        const callback = approvalCallbacks.get(request.id);
        if (callback) {
            approvalCallbacks.delete(request.id);
            callback.reject(new Error('Session ended'));
        }
    }
    session.pendingApprovals = [];
}
// Format approval request for display
export function formatApprovalMessage(request) {
    const lines = [];
    if (request.type === 'file_edit') {
        lines.push('📝 Approval needed: Edit files');
        lines.push('');
        lines.push('📄 Changes:');
        if (request.files) {
            for (const file of request.files) {
                lines.push(`• ${file.path} (+${file.additions}, -${file.deletions})`);
            }
        }
    }
    else {
        lines.push('📝 Approval needed: Run command');
        lines.push('');
        lines.push(`🔧 \`${request.command}\``);
    }
    lines.push('');
    lines.push('/approve — allow changes');
    lines.push('/reject — deny changes');
    lines.push('/diff — see what will change first');
    lines.push(`⏱️ Expires in ${Math.round((request.expiresAt - Date.now()) / 60000)} min (auto-reject)`);
    return lines.join('\n');
}
