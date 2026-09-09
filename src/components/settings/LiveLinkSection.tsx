import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SCOPE_LABELS, type ExportScope } from '../../lib/dataExport';
import { selectionHaptic, successHaptic, tapHaptic } from '../../lib/haptics';
import {
  clearSnapshot,
  hasLiveLinkSecret,
  lastLiveLinkStatus,
  pushSnapshot,
  setLiveLinkSecret,
  type LiveLinkStatus,
} from '../../lib/liveLink';
import { useSettings } from '../../store/settings';
import { SPACING, taskColor, useTheme } from '../../theme';
import { SettingsRow } from './SettingsRow';
import { SettingsSection } from './SettingsSection';

const SCOPES: ExportScope[] = ['schedule', 'clients', 'everything'];

/**
 * Sharing a live copy of everything with an assistant.
 *
 * Written to be read before it is switched on. The thing being offered is
 * genuinely useful and genuinely exposing, and a switch with a cheerful
 * label would be doing the user a disservice — so the scope is named in
 * plain words, the widest one says what it means, and turning the whole
 * thing off is a single tap that also deletes what was already shared.
 */
export function LiveLinkSection() {
  const theme = useTheme();
  const enabled = useSettings((s) => s.settings.liveLinkEnabled);
  const scope = useSettings((s) => s.settings.liveLinkScope);
  const update = useSettings((s) => s.update);

  const [hasSecret, setHasSecret] = useState(false);
  const [secretDraft, setSecretDraft] = useState('');
  const [status, setStatus] = useState<LiveLinkStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    void hasLiveLinkSecret().then(setHasSecret);
    void lastLiveLinkStatus().then(setStatus);
  };
  useEffect(refresh, []);

  const turnOn = () => {
    Alert.alert(
      'Share a live copy?',
      `A copy of your data goes to your relay and stays there, updated as you use the app. Anyone with the data secret can read it — at the "${SCOPE_LABELS[scope].title}" level that means:\n\n${SCOPE_LABELS[scope].detail}\n\nTurning this off again deletes the shared copy.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Share it',
          style: 'destructive',
          onPress: async () => {
            update({ liveLinkEnabled: true });
            setBusy(true);
            const ok = await pushSnapshot();
            setBusy(false);
            refresh();
            if (ok) successHaptic();
          },
        },
      ]
    );
  };

  const turnOff = async () => {
    setBusy(true);
    update({ liveLinkEnabled: false });
    await clearSnapshot();
    setBusy(false);
    refresh();
  };

  return (
    <SettingsSection
      title="Live link"
      caption="Let an assistant read your data as it is now, and make changes you asked for. Off unless you switch it on."
    >
      <View style={styles.field}>
        <Text style={[styles.label, { color: theme.textTertiary }]}>Data secret</Text>
        <View style={styles.row}>
          <TextInput
            value={secretDraft}
            onChangeText={setSecretDraft}
            placeholder={hasSecret ? 'Saved — paste a new one to replace it' : 'Paste the secret'}
            placeholderTextColor={theme.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={[
              styles.input,
              { color: theme.text, backgroundColor: theme.surface, borderColor: theme.separator },
            ]}
            accessibilityLabel="Live link data secret"
          />
          <Pressable
            onPress={async () => {
              tapHaptic();
              await setLiveLinkSecret(secretDraft || null);
              setSecretDraft('');
              refresh();
            }}
            disabled={!secretDraft.trim()}
            style={[
              styles.saveBtn,
              { backgroundColor: theme.accent, opacity: secretDraft.trim() ? 1 : 0.4 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Save the data secret"
          >
            <Text style={styles.saveLabel}>Save</Text>
          </Pressable>
        </View>
        <Text style={[styles.hint, { color: theme.textTertiary }]}>
          Not the same secret as your messages relay. Set it in Cloudflare as DATA_SECRET.
        </Text>
      </View>

      <View style={styles.field}>
        <Text style={[styles.label, { color: theme.textTertiary }]}>How much to share</Text>
        <View style={[styles.scopeRow, { backgroundColor: theme.surface }]}>
          {SCOPES.map((s) => {
            const on = scope === s;
            return (
              <Pressable
                key={s}
                onPress={() => {
                  selectionHaptic();
                  update({ liveLinkScope: s });
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={SCOPE_LABELS[s].title}
                style={[styles.scopeOption, on && { backgroundColor: theme.accent }]}
              >
                <Text
                  numberOfLines={1}
                  style={[styles.scopeLabel, { color: on ? '#fff' : theme.textSecondary }]}
                >
                  {s === 'schedule' ? 'Schedule' : s === 'clients' ? 'Clients' : 'Everything'}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[styles.hint, { color: theme.textTertiary }]}>
          {SCOPE_LABELS[scope].detail}
        </Text>
      </View>

      <View style={styles.toggleRow}>
        <View style={styles.flex}>
          <Text style={[styles.toggleLabel, { color: theme.text }]}>
            {enabled ? 'Sharing a live copy' : 'Not sharing'}
          </Text>
          <Text style={[styles.hint, { color: theme.textTertiary }]}>
            {enabled
              ? 'Updated as you use the app. Turning this off deletes the shared copy.'
              : hasSecret
                ? 'Nothing is shared until you switch this on.'
                : 'Save a data secret first.'}
          </Text>
        </View>
        {busy ? (
          <ActivityIndicator size="small" color={theme.textTertiary} />
        ) : (
          <Switch
            value={enabled}
            disabled={!hasSecret}
            onValueChange={(on) => {
              selectionHaptic();
              if (on) turnOn();
              else void turnOff();
            }}
            trackColor={{ false: theme.surface, true: theme.danger }}
            ios_backgroundColor={theme.surface}
            accessibilityLabel="Share a live copy with an assistant"
          />
        )}
      </View>

      {status ? (
        <SettingsRow
          icon={status.ok ? 'checkmark-circle' : 'alert-circle'}
          tint={status.ok ? taskColor('emerald').solid : theme.danger}
          label="Last update"
          sublabel={status.text}
        />
      ) : null}

      {enabled ? (
        <SettingsRow
          icon="refresh"
          tint={taskColor('violet').solid}
          label="Share now"
          sublabel="Push the current state without waiting"
          onPress={async () => {
            tapHaptic();
            setBusy(true);
            await pushSnapshot();
            setBusy(false);
            refresh();
          }}
          right={busy ? <ActivityIndicator size="small" color={theme.textTertiary} /> : undefined}
        />
      ) : null}
    </SettingsSection>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  field: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, gap: 6 },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
  hint: { fontSize: 12, lineHeight: 17 },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  input: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
  },
  saveBtn: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12 },
  saveLabel: { color: '#fff', fontSize: 14, fontWeight: '700' },
  scopeRow: { flexDirection: 'row', borderRadius: 12, padding: 3, gap: 3 },
  scopeOption: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  scopeLabel: { fontSize: 13, fontWeight: '700' },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  toggleLabel: { fontSize: 15, fontWeight: '600' },
});
