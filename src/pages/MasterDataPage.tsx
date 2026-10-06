import { useCallback, useEffect, useRef, useState } from "react";

import { ImportError, type ImportDataset, type ImportResult, type PreparedImport } from "../importer";
import type { BackupRestoreServicePort } from "../backupRestore";
import { BackupRestoreSection } from "../components/backupRestore/BackupRestoreSection";
import type {
  MasterDataStatus,
  MasterDataStatusRepositoryPort,
  MasterImportServicePort,
} from "../masterData/types";
import { openGvdbSite } from "../masterData/openGvdbSite";

interface MasterDataPageProps {
  statusRepository: MasterDataStatusRepositoryPort;
  importService: MasterImportServicePort;
  backupRestoreService: BackupRestoreServicePort;
}

const DATASETS: ImportDataset[] = ["quests", "discoveries"];

export function MasterDataPage({ statusRepository, importService, backupRestoreService }: MasterDataPageProps) {
  const [status, setStatus] = useState<MasterDataStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [prepared, setPrepared] = useState<Partial<Record<ImportDataset, PreparedImport>>>({});
  const [results, setResults] = useState<Partial<Record<ImportDataset, ImportResult>>>({});
  const [errors, setErrors] = useState<Partial<Record<ImportDataset, DisplayImportError>>>({});
  const [selectingDataset, setSelectingDataset] = useState<ImportDataset | null>(null);
  const [importingDataset, setImportingDataset] = useState<ImportDataset | null>(null);
  const [isOpeningGvdb, setIsOpeningGvdb] = useState(false);
  const [gvdbOpenError, setGvdbOpenError] = useState(false);
  const active = useRef(true);

  const loadStatus = useCallback(async () => {
    setIsLoading(true);
    setStatusError(null);
    try {
      const loaded = await statusRepository.getStatus();
      if (active.current) setStatus(loaded);
    } catch (error: unknown) {
      console.error("Master data status load failed", error);
      if (active.current) setStatusError("マスターデータの状態を読み込めませんでした。");
    } finally {
      if (active.current) setIsLoading(false);
    }
  }, [statusRepository]);

  useEffect(() => {
    active.current = true;
    void loadStatus();
    return () => {
      active.current = false;
    };
  }, [loadStatus, reload]);

  async function selectFile(dataset: ImportDataset) {
    if (selectingDataset !== null || importingDataset !== null) return;
    setSelectingDataset(dataset);
    setErrors((current) => ({ ...current, [dataset]: undefined }));
    setResults((current) => ({ ...current, [dataset]: undefined }));
    try {
      const selection = await importService.selectFile(dataset);
      if (selection) setPrepared((current) => ({ ...current, [dataset]: selection }));
    } catch (error: unknown) {
      console.error("Master import file preparation failed", error);
      setErrors((current) => ({ ...current, [dataset]: displayImportError(error) }));
    } finally {
      setSelectingDataset(null);
    }
  }

  async function runImport(dataset: ImportDataset) {
    const selection = prepared[dataset];
    if (!selection || importingDataset !== null) return;
    setImportingDataset(dataset);
    setErrors((current) => ({ ...current, [dataset]: undefined }));
    setResults((current) => ({ ...current, [dataset]: undefined }));
    try {
      const result = await importService.importPrepared(selection);
      setResults((current) => ({ ...current, [dataset]: result }));
      setPrepared((current) => ({ ...current, [dataset]: undefined }));
      await loadStatus();
    } catch (error: unknown) {
      console.error("Master import failed", error);
      setErrors((current) => ({ ...current, [dataset]: displayImportError(error) }));
    } finally {
      setImportingDataset(null);
    }
  }

  async function openSourceSite() {
    if (isOpeningGvdb) return;
    setIsOpeningGvdb(true);
    setGvdbOpenError(false);
    try {
      await openGvdbSite();
    } catch (error: unknown) {
      console.error("GVDB site open failed", error);
      setGvdbOpenError(true);
    } finally {
      setIsOpeningGvdb(false);
    }
  }

  return (
    <section aria-labelledby="master-data-title">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">ローカルファイルから更新</p>
          <h2 id="master-data-title">マスターデータ</h2>
          <p>手動で取得したGVDBファイルだけを使用します。自動ダウンロードは行いません。</p>
        </div>
      </div>

      {statusError && <div className="error-banner" role="alert"><span>{statusError}</span><button type="button" className="button secondary" onClick={() => setReload((value) => value + 1)}>再読み込み</button></div>}
      {isLoading && status === null ? <div className="state-panel" role="status">マスターデータの状態を読み込んでいます…</div> : status ? (
        <>
          <div className="master-dataset-grid">
            {DATASETS.map((dataset) => (
              <DatasetPanel
                key={dataset}
                dataset={dataset}
                status={status.datasets[dataset]}
                prepared={prepared[dataset]}
                result={results[dataset]}
                error={errors[dataset]}
                selecting={selectingDataset === dataset}
                importing={importingDataset === dataset}
                disabled={importingDataset !== null || selectingDataset !== null}
                onSelect={() => void selectFile(dataset)}
                onCancel={() => setPrepared((current) => ({ ...current, [dataset]: undefined }))}
                onImport={() => void runImport(dataset)}
              />
            ))}
          </div>
          <ImportHistory status={status} />
        </>
      ) : null}
      <BackupRestoreSection service={backupRestoreService} />
      <section className="master-attribution" aria-labelledby="master-attribution-title">
        <h3 id="master-attribution-title">データ提供元・謝辞</h3>
        <p>
          本アプリのマスターデータには「大航海時代データベース」で公開されているデータを利用しています。
        </p>
        <p>
          長年にわたりデータを収集・整理・更新・公開してくださっているサイト運営者、編集者、情報提供者をはじめとするコミュニティの皆さまに感謝します。
        </p>
        <button type="button" className="external-link-button" disabled={isOpeningGvdb} onClick={() => void openSourceSite()}>
          大航海時代データベースを開く（外部サイト）
        </button>
        {gvdbOpenError && <p className="field-error" role="alert">既定ブラウザーでサイトを開けませんでした。ブラウザーの設定を確認してください。</p>}
      </section>
    </section>
  );
}

interface DatasetPanelProps {
  dataset: ImportDataset;
  status: MasterDataStatus["datasets"][ImportDataset];
  prepared?: PreparedImport;
  result?: ImportResult;
  error?: DisplayImportError;
  selecting: boolean;
  importing: boolean;
  disabled: boolean;
  onSelect(): void;
  onCancel(): void;
  onImport(): void;
}

function DatasetPanel(props: DatasetPanelProps) {
  const label = props.dataset === "quests" ? "クエスト" : "発見物";
  const expectedFile = props.dataset === "quests" ? "quests.csv" : "discovery_items.csv";
  return (
    <article className="master-dataset-card" aria-labelledby={`${props.dataset}-master-title`}>
      <h3 id={`${props.dataset}-master-title`}>{label}マスター</h3>
      <dl className="master-status-list">
        <div><dt>有効件数</dt><dd>{props.status.activeCount.toLocaleString("ja-JP")}件</dd></div>
        <div><dt>最終インポート</dt><dd>{formatDate(props.status.latestImport?.importedAt)}</dd></div>
        <div><dt>ファイル</dt><dd>{props.status.latestImport?.fileName ?? "—"}</dd></div>
        <div><dt>ソース最終更新</dt><dd>{props.status.latestImport?.sourceMaxUpdatedAt ?? "—"}</dd></div>
      </dl>
      <button type="button" className="button secondary" disabled={props.disabled} onClick={props.onSelect}>
        {props.selecting ? "ファイルを確認中…" : `${expectedFile} を選択`}
      </button>

      {props.prepared && (
        <div className="import-confirmation" aria-label={`${label}インポート確認`}>
          <h4>選択したファイル</h4>
          <dl>
            <div><dt>ファイル名</dt><dd>{props.prepared.fileName}</dd></div>
            <div><dt>データセット</dt><dd>{label}</dd></div>
            <div><dt>SHA-256</dt><dd className="hash-value">{props.prepared.sha256}</dd></div>
            <div><dt>解析行数</dt><dd>{props.prepared.rowCount.toLocaleString("ja-JP")}件</dd></div>
          </dl>
          <p>ファイルを選択しただけではDBは更新されていません。</p>
          <div className="import-actions">
            <button type="button" className="button secondary" disabled={props.importing} onClick={props.onCancel}>キャンセル</button>
            <button type="button" className="button primary" disabled={props.disabled} onClick={props.onImport}>
              {props.importing ? `${label}をインポート中…` : `${label}情報を更新`}
            </button>
          </div>
        </div>
      )}

      {props.importing && <p className="import-running" role="status">{label}マスターをインポート中です。操作せずお待ちください…</p>}
      {props.error && <ImportErrorMessage error={props.error} />}
      {props.result && <ImportSuccess result={props.result} label={label} />}
    </article>
  );
}

function ImportSuccess({ result, label }: { result: ImportResult; label: string }) {
  return (
    <div className="import-success" role="status">
      <h4>{label}マスターを更新しました。</h4>
      <dl>
        <div><dt>読み込み</dt><dd>{result.importedRowCount.toLocaleString("ja-JP")}件</dd></div>
        <div><dt>新規</dt><dd>{result.insertedCount.toLocaleString("ja-JP")}件</dd></div>
        <div><dt>更新</dt><dd>{result.updatedCount.toLocaleString("ja-JP")}件</dd></div>
        <div><dt>非アクティブ</dt><dd>{result.inactiveCount.toLocaleString("ja-JP")}件</dd></div>
        <div><dt>関連</dt><dd>{result.relationCount.toLocaleString("ja-JP")}件</dd></div>
        <div><dt>警告</dt><dd>{result.warningCount.toLocaleString("ja-JP")}件</dd></div>
      </dl>
      {result.warningCount > 0 && (
        <details className="warning-details">
          <summary>警告の詳細を確認</summary>
          <ol>
            {result.warnings.slice(0, 100).map((warning, index) => (
              <li key={`${warning.code}:${warning.rowNumber ?? 0}:${index}`}>
                <strong>{warning.code}</strong>{warning.rowNumber ? `（行 ${warning.rowNumber}）` : ""}: {warning.message}
              </li>
            ))}
          </ol>
          {result.warnings.length > 100 && <p>残り{(result.warnings.length - 100).toLocaleString("ja-JP")}件は表示を省略しました。</p>}
        </details>
      )}
    </div>
  );
}

function ImportErrorMessage({ error }: { error: DisplayImportError }) {
  return (
    <div className="import-error" role="alert">
      <strong>{error.message}</strong>
      {error.detail && <p>{error.detail}</p>}
    </div>
  );
}

function ImportHistory({ status }: { status: MasterDataStatus }) {
  return (
    <section className="import-history" aria-labelledby="import-history-title">
      <h3 id="import-history-title">最近のインポート履歴</h3>
      {status.recentHistory.length === 0 ? <p>インポート履歴はありません。</p> : (
        <div className="import-history-scroll"><table><thead><tr><th scope="col">データセット</th><th scope="col">ファイル</th><th scope="col">行数</th><th scope="col">ソース最終更新</th><th scope="col">インポート日時</th></tr></thead><tbody>{status.recentHistory.map((entry) => <tr key={entry.id}><td>{entry.dataset === "quests" ? "クエスト" : "発見物"}</td><td>{entry.fileName}</td><td>{entry.rowCount?.toLocaleString("ja-JP") ?? "—"}</td><td>{entry.sourceMaxUpdatedAt ?? "—"}</td><td>{formatDate(entry.importedAt)}</td></tr>)}</tbody></table></div>
      )}
    </section>
  );
}

interface DisplayImportError { message: string; detail: string | null }

function displayImportError(error: unknown): DisplayImportError {
  if (!(error instanceof ImportError)) {
    return { message: "インポート処理に失敗しました。", detail: null };
  }
  if (error.kind === "DuplicateImport") return { message: "このファイルは既にインポートされています。", detail: null };
  if (error.kind === "DatabaseImportError") return { message: "データベースへの取り込みに失敗しました。", detail: null };
  return { message: error.userMessage, detail: error.detail.slice(0, 500) };
}

function formatDate(value: string | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ja-JP");
}
