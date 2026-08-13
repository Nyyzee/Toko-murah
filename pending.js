// =========================================
// SIMPAN TRANSAKSI PENDING
// Key: ref_id, Value: data transaksi
// =========================================

const pendingMap = new Map();

function savePending(refId, data) {
    pendingMap.set(refId, data);
}

function getPending(refId) {
    return pendingMap.get(refId) || null;
}

function deletePending(refId) {
    pendingMap.delete(refId);
}

module.exports = {
    savePending,
    getPending,
    deletePending
};
