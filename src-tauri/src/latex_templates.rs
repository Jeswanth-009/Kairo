pub const CLASSIC_PREAMBLE: &str = r#"\documentclass[10pt,letterpaper]{article}
\usepackage[T1]{fontenc}
\usepackage[margin=0.6in]{geometry}
\usepackage[hidelinks]{hyperref}
\usepackage{enumitem}
\pagestyle{empty}
\setlength{\parindent}{0pt}

\newcommand{\resumeHeader}[3]{
  \begin{center}
    {\LARGE \textbf{#1}}\\[2pt]
    \ifx&#2& \else #2\\[4pt] \fi
    \small #3
  \end{center}
}

\newcommand{\resumeSection}[1]{
  \vspace{8pt}\noindent{\large\textbf{\MakeUppercase{#1}}}\\[-2pt]
  \rule{\linewidth}{0.8pt}\vspace{4pt}\par
}

\newcommand{\resumeItem}[3]{
  \noindent\textbf{#1}%
  \ifx&#2& \else \textit{ -- #2} \fi
  \hfill #3\par
}

\newcommand{\resumeDesc}[1]{
  \noindent #1\par
}

\newenvironment{resumeItemList}{
  \begin{itemize}[leftmargin=*, itemsep=1pt, topsep=2pt, parsep=0pt]
}{
  \end{itemize}
}

\newcommand{\resumeItemBullet}[1]{
  \item #1
}

\newcommand{\resumeSkills}[1]{
  \noindent #1\par
}
"#;

pub const MINIMAL_PREAMBLE: &str = r#"\documentclass[10pt,letterpaper]{article}
\usepackage[T1]{fontenc}
\usepackage[margin=0.7in]{geometry}
\usepackage[hidelinks]{hyperref}
\usepackage{enumitem}
\usepackage{lato} % Clean sans-serif font
\renewcommand{\familydefault}{\sfdefault}
\pagestyle{empty}
\setlength{\parindent}{0pt}

\newcommand{\resumeHeader}[3]{
  \begin{center}
    {\Huge \textbf{#1}}\\[4pt]
    \ifx&#2& \else {\Large \textcolor{darkgray}{#2}}\\[6pt] \fi
    \small #3
  \end{center}
}

\newcommand{\resumeSection}[1]{
  \vspace{12pt}\noindent{\Large\textbf{#1}}\\[-4pt]
  \rule{\linewidth}{0.4pt}\vspace{6pt}\par
}

\newcommand{\resumeItem}[3]{
  \noindent\textbf{#1}%
  \ifx&#2& \else \textit{, #2} \fi
  \hfill \textit{#3}\par
}

\newcommand{\resumeDesc}[1]{
  \noindent #1\par\vspace{2pt}
}

\newenvironment{resumeItemList}{
  \begin{itemize}[leftmargin=12pt, itemsep=2pt, topsep=2pt, parsep=0pt]
}{
  \end{itemize}
}

\newcommand{\resumeItemBullet}[1]{
  \item #1
}

\newcommand{\resumeSkills}[1]{
  \noindent #1\par
}
"#;

pub const MODERN_PREAMBLE: &str = r#"\documentclass[11pt,letterpaper]{article}
\usepackage[T1]{fontenc}
\usepackage[margin=0.75in]{geometry}
\usepackage[hidelinks]{hyperref}
\usepackage{enumitem}
\usepackage{palatino} % Elegant serif font
\usepackage{xcolor}
\definecolor{primary}{RGB}{33, 73, 143}
\pagestyle{empty}
\setlength{\parindent}{0pt}

\newcommand{\resumeHeader}[3]{
  {\Huge \textcolor{primary}{\textbf{#1}}}\\[4pt]
  \ifx&#2& \else {\Large \textit{#2}}\\[6pt] \fi
  \small #3
  \vspace{6pt}
}

\newcommand{\resumeSection}[1]{
  \vspace{10pt}\noindent{\Large\textcolor{primary}{\MakeUppercase{#1}}}\\[-4pt]
  \textcolor{primary}{\rule{\linewidth}{1.2pt}}\vspace{6pt}\par
}

\newcommand{\resumeItem}[3]{
  \noindent{\large \textbf{#1}}%
  \ifx&#2& \else \hfill \textbf{#2} \fi
  \\[2pt]
  {\small \textit{#3}}\par
}

\newcommand{\resumeDesc}[1]{
  \noindent #1\par\vspace{2pt}
}

\newenvironment{resumeItemList}{
  \begin{itemize}[leftmargin=*, itemsep=2pt, topsep=4pt, parsep=0pt]
}{
  \end{itemize}
}

\newcommand{\resumeItemBullet}[1]{
  \item #1
}

\newcommand{\resumeSkills}[1]{
  \noindent #1\par
}
"#;
