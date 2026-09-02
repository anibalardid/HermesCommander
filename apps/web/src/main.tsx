import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './i18n';
import './index.css';
import { AppShell } from './components/AppShell';
import { OfficeView } from './components/views/OfficeView';
import { Office1View } from './components/views/Office1View';
import { NewProjectView } from './components/views/NewProjectView';
import { ProjectDetailView } from './components/views/ProjectDetailView';
import { NewMissionView } from './components/views/NewMissionView';
import { MissionDetailView } from './components/views/MissionDetailView';
import { SettingsView } from './components/views/SettingsView';
import { HelpView } from './components/views/HelpView';
import { TasksView } from './components/views/TasksView';
import { PrDetailView } from './components/views/PrDetailView';
import { ResumeView } from './components/views/ResumeView';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<OfficeView />} />
          <Route path="office" element={<Office1View />} />
          <Route path="new" element={<NewProjectView />} />
          <Route path="project/:id" element={<ProjectDetailView />} />
          <Route path="project/:id/new-mission" element={<NewMissionView />} />
          <Route path="mission/:id" element={<MissionDetailView />} />
          <Route path="settings" element={<SettingsView />} />
          <Route path="help" element={<HelpView />} />
          <Route path="tasks" element={<TasksView />} />
          <Route path="resume" element={<ResumeView />} />
          <Route path="pr/:projectId/:number" element={<PrDetailView />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
